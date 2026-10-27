package com.example.aring;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URI;
import java.io.InputStream;

final class AringSync {
    // Bundled native app contacts only the two fixed HTTPS origins. Mail/browser sessions
    // cannot silently replace the independently revocable native credential.
    static final String PUBLIC_ORIGIN="https://calendar.example.test";
    static final String PRIVATE_ORIGIN="https://calendar.private.example.test:8443";
    static final Object SYNC_LOCK=new Object();
    static String origin(Context context){String value=context.getSharedPreferences("connection",0).getString("origin",PUBLIC_ORIGIN);return PRIVATE_ORIGIN.equals(value)?PRIVATE_ORIGIN:PUBLIC_ORIGIN;}
    static JSONObject request(Context context,String path,JSONObject body,boolean authenticated) throws Exception {
        return request(context,path,body,authenticated,origin(context));
    }
    static JSONObject request(Context context,String path,JSONObject body,boolean authenticated,String origin) throws Exception {
        if(!PUBLIC_ORIGIN.equals(origin)&&!PRIVATE_ORIGIN.equals(origin))throw new IllegalStateException("Unrecognized calendar service");
        HttpURLConnection connection=(HttpURLConnection)URI.create(origin+path).toURL().openConnection();
        connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept","application/json");
        if(authenticated){String token=AringState.token(context);if(token==null)throw new IllegalStateException("Sign in required to resume synchronization");connection.setRequestProperty("Authorization","Bearer "+token);}
        try {
            if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();
            if(status==401)throw new IllegalStateException("/api/login".equals(path)?"Email or password was not recognized. Use your Áring account password.":"Sign in required to resume synchronization");
            if(status==429)throw new IllegalStateException("Too many attempts. Try again in 15 minutes.");
            if(status!=200)throw new IllegalStateException("Synchronization unavailable ("+status+")");
            try(InputStream input=connection.getInputStream()){
                java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n,total=0;
                while((n=input.read(buffer))!=-1){total+=n;if(total>16*1024*1024)throw new IllegalStateException("Calendar response too large");output.write(buffer,0,n);}
                return new JSONObject(output.toString("UTF-8"));
            }
        } finally {connection.disconnect();}
    }
    static JSONObject sync(Context context) throws Exception {
        synchronized(SYNC_LOCK){
            JSONObject state=AringState.read(context),user=state.optJSONObject("user");
            if(user==null||"local-only".equals(user.optString("id")))return state;
            JSONArray sent=new JSONArray(),pending=state.optJSONArray("inFlight");if(pending==null||pending.length()==0)pending=state.getJSONArray("pending");for(int i=0;i<Math.min(100,pending.length());i++)sent.put(pending.getJSONObject(i));
            synchronized(AringState.LOCK){JSONObject latest=AringState.read(context);latest.put("inFlight",sent);AringState.save(context,latest);}
            try {
                JSONObject response=request(context,"/api/sync",new JSONObject().put("operations",sent),true);
                JSONObject merged=AringState.merge(context,response,sent,user.getString("id"));AringAlerts.reconcile(context);if(merged.getJSONArray("pending").length()>0)AringJobs.soon(context);return merged;
            } catch(Exception error){
                synchronized(AringState.LOCK){JSONObject latest=AringState.read(context);if(user.getString("id").equals(latest.optJSONObject("user")!=null?latest.getJSONObject("user").optString("id"):null)){latest.put("status",error.getMessage()!=null&&error.getMessage().startsWith("Sign in")?"Sign in required to resume synchronization. Your local changes are saved.":"Synchronization failed. Your local changes are saved.");AringState.save(context,latest);}}
                throw error;
            }
        }
    }
}
