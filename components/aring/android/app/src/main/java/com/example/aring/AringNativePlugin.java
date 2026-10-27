package com.example.aring;

import android.Manifest;
import android.app.AlarmManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name="AringNative",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
@android.annotation.SuppressLint("ApplySharedPref") // persist the credential's service origin off the main thread
public class AringNativePlugin extends Plugin {
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    interface Work {JSONObject run() throws Exception;}
    private void run(PluginCall call,Work work){executor.execute(()->{try{call.resolve(JSObject.fromJSONObject(work.run()));}catch(Exception error){call.reject(error.getMessage()!=null?error.getMessage():"Native operation failed");}});}
    private JSONObject stateResult(JSONObject state)throws Exception{return new JSONObject().put("state",state);}
    @PluginMethod public void readState(PluginCall call){run(call,()->stateResult(AringState.read(getContext())));}
    @PluginMethod public void login(PluginCall call){signIn(call,false);}
    @PluginMethod public void reauthenticate(PluginCall call){signIn(call,true);}
    private void signIn(PluginCall call,boolean preserve){run(call,()->{
        synchronized(AringSync.SYNC_LOCK){
            String origin=preserve?AringSync.origin(getContext()):"private".equals(call.getString("connection"))?AringSync.PRIVATE_ORIGIN:AringSync.PUBLIC_ORIGIN;
            JSONObject response=AringSync.request(getContext(),"/api/login",new JSONObject().put("email",call.getString("email")).put("password",call.getString("password")).put("device",true).put("deviceName",Build.MANUFACTURER+" "+Build.MODEL),false,origin);
            JSONObject old=AringState.read(getContext());
            if(preserve&&(!old.getJSONObject("user").getString("id").equals(response.getJSONObject("user").getString("id"))))throw new IllegalStateException("Use the same account to preserve pending changes");
            if(!getContext().getSharedPreferences("connection",0).edit().putString("origin",origin).commit())throw new IllegalStateException("Unable to save calendar connection");
            AringState.token(getContext(),response.getString("token"));response.remove("token");
            JSONObject state;
            if(preserve){response.put("results",new JSONArray());state=AringState.merge(getContext(),response,new JSONArray(),old.getJSONObject("user").getString("id"));state.put("inFlight",old.optJSONArray("inFlight")!=null?old.getJSONArray("inFlight"):new JSONArray());AringState.save(getContext(),state);}
            else{state=AringState.empty();state.put("user",response.getJSONObject("user"));state.put("calendars",response.getJSONArray("calendars"));state.put("items",response.getJSONArray("items"));state.put("status","Synced");state.put("lastSync",java.time.Instant.now().toString());AringState.save(getContext(),state);}
            AringAlerts.reconcile(getContext());AringJobs.schedule(getContext());return stateResult(state);
        }
    });}
    @PluginMethod public void sync(PluginCall call){run(call,()->stateResult(AringSync.sync(getContext())));}
    @PluginMethod public void changeState(PluginCall call){run(call,()->{
        synchronized(AringState.LOCK){
            JSONObject change=call.getObject("change"),state=AringState.read(getContext());String type=change.getString("type");
            if(("mutation".equals(type)||"visibility".equals(type)||"resolve".equals(type))&&(state.optJSONObject("user")==null||!state.getJSONObject("user").optString("id").equals(change.optString("userId"))))throw new IllegalStateException("Account changed. Reopen Áring before editing.");
            if("mutation".equals(type)){state=AringState.mutate(getContext(),change.getJSONObject("mutation"));AringJobs.soon(getContext());}
            else if("import".equals(type)){
                if(!state.getJSONObject("user").getString("id").equals(change.getString("userId")))throw new IllegalStateException("Account changed during import");
                JSONObject imported=new JSONObject(state.toString());JSONArray items=change.getJSONArray("items");
                for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);imported=AringState.mutateValue(imported,new JSONObject().put("action","put").put("itemId",item.getString("id")).put("item",item).put("baseRevision",0));}
                state=imported;AringState.save(getContext(),state);AringJobs.soon(getContext());
            }
            else if("replace".equals(type)){state=change.getJSONObject("state");AringState.save(getContext(),state);}
            else if("clear".equals(type)){if(state.optJSONObject("user")!=null&&state.getJSONObject("user").optString("id").equals(change.optString("userId"))){state=AringState.empty();AringState.save(getContext(),state);}}
            else if("visibility".equals(type)){state.getJSONObject("visibility").put(change.getString("id"),change.getBoolean("visible"));AringState.save(getContext(),state);}
            else if("status".equals(type)){state.put("status",change.getString("status"));AringState.save(getContext(),state);}
            else if("resolve".equals(type)){
                JSONObject conflict=AringState.find(state.getJSONArray("conflicts"),"opId",change.getString("opId"));state.put("conflicts",AringState.without(state.getJSONArray("conflicts"),"opId",change.getString("opId")));AringState.save(getContext(),state);
                if(conflict!=null&&change.getBoolean("keep")){
                    JSONObject local=conflict.getJSONObject("local");
                    local.remove("baseRevision");
                    if(conflict.optJSONObject("current")==null&&"put".equals(local.optString("action"))){String id=java.util.UUID.randomUUID().toString();local.getJSONObject("item").put("id",id);local.put("itemId",id);}
                    state=AringState.mutate(getContext(),local);
                }
            }
            AringAlerts.reconcile(getContext());return stateResult(state);
        }
    });}
    @PluginMethod public void devices(PluginCall call){run(call,()->AringSync.request(getContext(),"/api/devices",null,true));}
    @PluginMethod public void exportData(PluginCall call){
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"aring-"+java.time.LocalDate.now()+".json");
        startActivityForResult(call,intent,"exportResult");
    }
    @ActivityCallback private void exportResult(PluginCall call,ActivityResult result){
        if(call==null)return;
        if(result.getResultCode()!=android.app.Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){JSObject cancelled=new JSObject();cancelled.put("ok",false);call.resolve(cancelled);return;}
        Uri uri=result.getData().getData();run(call,()->{try(java.io.OutputStream output=getContext().getContentResolver().openOutputStream(uri)){if(output==null)throw new IllegalStateException("Unable to write calendar export");output.write(AringState.read(getContext()).toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}return new JSONObject().put("ok",true);});
    }
    @PluginMethod public void revoke(PluginCall call){run(call,()->AringSync.request(getContext(),"/api/revoke",new JSONObject().put("id",call.getString("id")),true));}
    @PluginMethod public void logout(PluginCall call){run(call,()->{
        synchronized(AringSync.SYNC_LOCK){
            Exception error=null;try{AringSync.request(getContext(),"/api/logout",new JSONObject(),true);}catch(Exception e){error=e;}
            AringState.token(getContext(),null);AringState.save(getContext(),AringState.empty());AringAlerts.reconcile(getContext());
            if(error!=null)throw error;return new JSONObject().put("ok",true);
        }
    });}
    @PluginMethod public void notifications(PluginCall call){
        if(call.getBoolean("request",false)&&Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"permissionResult");return;}
        reportNotifications(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call){reportNotifications(call);}
    private void reportNotifications(PluginCall call){run(call,()->{AringAlerts.reconcile(getContext());return new JSONObject().put("message",AringAlerts.status(getContext()));});}
    @PluginMethod public void alarmSettings(PluginCall call){
        if(Build.VERSION.SDK_INT>=31){Intent intent=new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getContext().getPackageName()));getActivity().startActivity(intent);}
        call.resolve();
    }
    @Override protected void handleOnDestroy(){executor.shutdown();}
}
