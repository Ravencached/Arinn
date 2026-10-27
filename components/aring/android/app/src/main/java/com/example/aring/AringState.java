package com.example.aring;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@android.annotation.SuppressLint("ApplySharedPref") // durable credential writes run off the main thread
final class AringState {
    static final Object LOCK = new Object();
    private static SQLiteDatabase database;
    static SQLiteDatabase db(Context context) {
        if (database == null) {
            database = context.openOrCreateDatabase("aring.sqlite", Context.MODE_PRIVATE, null);
            database.execSQL("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
            database.enableWriteAheadLogging();
        }
        return database;
    }
    static JSONObject empty() throws Exception {
        return new JSONObject("{\"user\":null,\"calendars\":[],\"items\":[],\"pending\":[],\"conflicts\":[],\"visibility\":{},\"lastSync\":null,\"status\":\"Ready\"}");
    }
    static JSONObject read(Context context) throws Exception {
        synchronized (LOCK) {
            try (Cursor cursor = db(context).rawQuery("SELECT json FROM state WHERE id=1", null)) {
                return cursor.moveToFirst() ? new JSONObject(cursor.getString(0)) : empty();
            }
        }
    }
    static void save(Context context, JSONObject state) {
        synchronized (LOCK) { db(context).execSQL("INSERT OR REPLACE INTO state VALUES(1,?)", new Object[]{state.toString()}); }
    }
    static JSONObject find(JSONArray array, String field, String value) {
        for (int i=0;i<array.length();i++) {JSONObject item=array.optJSONObject(i);if(item!=null && value.equals(item.optString(field)))return item;}
        return null;
    }
    static JSONArray without(JSONArray array, String field, String value) {
        JSONArray result=new JSONArray();for(int i=0;i<array.length();i++){JSONObject obj=array.optJSONObject(i);if(obj!=null&&!value.equals(obj.optString(field)))result.put(obj);}return result;
    }
    static JSONObject mutate(Context context, JSONObject mutation) throws Exception {
        synchronized (LOCK) {
            JSONObject state=mutateValue(read(context),mutation);save(context,state);return state;
        }
    }
    static JSONObject mutateValue(JSONObject state,JSONObject mutation) throws Exception {
            String id=mutation.getString("itemId");
            JSONArray items=state.getJSONArray("items"),queue=state.getJSONArray("pending");
            JSONObject old=find(items,"id",id),prior=find(queue,"itemId",id),item=mutation.optJSONObject("item");
            if(state.optJSONObject("user")==null)throw new IllegalStateException("Sign in first");
            String calendar=item!=null?item.getString("calendarId"):old!=null?old.getString("calendarId"):mutation.optString("calendarId");
            JSONObject membership=find(state.getJSONArray("calendars"),"id",calendar);
            if(membership==null||!"editor".equals(membership.optString("role")))throw new IllegalStateException("Calendar unavailable");
            long base=prior!=null?prior.getLong("baseRevision"):mutation.has("baseRevision")?mutation.optLong("baseRevision"):old!=null?old.optLong("revision"):0;
            queue=without(queue,"itemId",id);items=without(items,"id",id);
            if(!("delete".equals(mutation.getString("action"))&&prior!=null&&base==0&&find(state.optJSONArray("inFlight")!=null?state.getJSONArray("inFlight"):new JSONArray(),"itemId",id)==null)){
                JSONObject op=new JSONObject(mutation.toString());op.put("opId",UUID.randomUUID().toString());op.put("baseRevision",base);op.put("calendarId",calendar);queue.put(op);
                if(item!=null){item=new JSONObject(item.toString());item.put("revision",base);item.put("pending",true);items.put(item);}
            }
            state.put("items",items);state.put("pending",queue);state.put("status","Changes saved on this device");return state;
    }
    static JSONObject merge(Context context, JSONObject response, JSONArray sent, String userId) throws Exception {
        synchronized (LOCK) {
            JSONObject state=mergeValue(read(context),response,sent,userId);save(context,state);return state;
        }
    }
    static JSONObject mergeValue(JSONObject state,JSONObject response,JSONArray sent,String userId) throws Exception {
            if(state.optJSONObject("user")==null||!userId.equals(state.getJSONObject("user").optString("id"))||!userId.equals(response.getJSONObject("user").getString("id")))return state;
            JSONArray pending=state.getJSONArray("pending"),results=response.getJSONArray("results"),calendars=response.getJSONArray("calendars"),next=new JSONArray(),conflicts=new JSONArray(),items=response.getJSONArray("items");
            for(int i=0;i<state.getJSONArray("conflicts").length();i++){
                JSONObject c=state.getJSONArray("conflicts").getJSONObject(i),local=c.optJSONObject("local");
                if(local!=null&&find(calendars,"id",local.optJSONObject("item")!=null?local.getJSONObject("item").optString("calendarId"):local.optString("calendarId"))!=null)conflicts.put(c);
            }
            for(int i=0;i<pending.length();i++){
                JSONObject op=pending.getJSONObject(i),item=op.optJSONObject("item");
                String calendar=item!=null?item.optString("calendarId"):op.optString("calendarId");
                if(find(calendars,"id",calendar)==null)continue;
                JSONObject old=find(sent,"itemId",op.getString("itemId"));
                JSONObject result=find(results,"opId",op.getString("opId"));
                if(result==null&&old!=null){JSONObject oldResult=find(results,"opId",old.optString("opId"));if(oldResult!=null&&("conflict".equals(oldResult.optString("status"))||"invalid".equals(oldResult.optString("status"))))result=oldResult;}
                if(result!=null){
                    String status=result.getString("status");
                    if("conflict".equals(status)||"invalid".equals(status)){JSONObject c=new JSONObject(result.toString());c.put("opId",op.getString("opId"));c.put("local",op);conflicts.put(c);continue;}
                    if("ok".equals(status)||"denied".equals(status))continue;
                }
                JSONObject ack=old!=null?find(results,"opId",old.optString("opId")):null;
                if(ack!=null&&"ok".equals(ack.optString("status"))&&op.optLong("baseRevision")==old.optLong("baseRevision"))op.put("baseRevision",ack.getLong("revision"));
                next.put(op);
                items=without(items,"id",op.getString("itemId"));
                if(item!=null){JSONObject overlay=new JSONObject(item.toString());overlay.put("revision",op.getLong("baseRevision"));overlay.put("pending",true);items.put(overlay);}
            }
            boolean denied=false;for(int i=0;i<results.length();i++)if("denied".equals(results.getJSONObject(i).optString("status")))denied=true;
            state.put("user",response.getJSONObject("user"));state.put("calendars",calendars);state.put("items",items);state.put("pending",next);state.put("inFlight",new JSONArray());state.put("conflicts",conflicts);state.put("lastSync",java.time.Instant.now().toString());state.put("status",denied?"Access changed; unauthorized queued changes were removed.":conflicts.length()>0?"Changes need your review.":"Synced");return state;
    }
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias("aring-device")){
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("aring-device",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }
        return (SecretKey)store.getKey("aring-device",null);
    }
    static void token(Context context, String token) throws Exception {
        if(token==null){context.getSharedPreferences("credential",0).edit().clear().commit();return;}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        boolean saved=context.getSharedPreferences("credential",0).edit().putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).putString("token",Base64.encodeToString(encrypted,Base64.NO_WRAP)).commit();
        if(!saved)throw new IllegalStateException("Unable to save device credential");
    }
    static String token(Context context) throws Exception {
        android.content.SharedPreferences prefs=context.getSharedPreferences("credential",0);String value=prefs.getString("token",null);if(value==null)return null;
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(value,Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8);
    }
}
