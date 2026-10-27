package com.example.aring;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;

@android.annotation.SuppressLint("ApplySharedPref") // persist the alarm ledger before a receiver exits
public class AringAlerts extends BroadcastReceiver {
    static final String CHANNEL="aring-reminders";
    private static PendingIntent pending(Context context,int id,JSONObject alert){
        Intent intent=new Intent(context,AringAlerts.class).setAction("com.example.aring.ALERT");
        if(alert!=null)intent.putExtra("alert",alert.toString());
        return PendingIntent.getBroadcast(context,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static String status(Context context){
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if(!manager.areNotificationsEnabled())return "Notifications are off. Enable them to receive reminder alerts.";
        if(Build.VERSION.SDK_INT>=31&&!context.getSystemService(AlarmManager.class).canScheduleExactAlarms())return "Alerts are scheduled locally. Exact alarm permission is off; Android may delay them.";
        try { if(plan(AringState.read(context),System.currentTimeMillis()).size()>=499)return "The next 499 alerts are scheduled locally. Additional alerts will be scheduled as the horizon advances."; } catch(Exception ignored) { return "Alert scheduling needs attention. Reopen Áring to retry."; }
        return "Alerts are scheduled locally, including while offline. Android may limit background synchronization.";
    }
    static List<JSONObject> plan(JSONObject state,long now) throws Exception {
        Comparator<JSONObject> order=Comparator.comparingLong((JSONObject o)->o.optLong("at")).thenComparing(o->o.optString("key"));
        PriorityQueue<JSONObject> closest=new PriorityQueue<>(order.reversed());ZoneId displayZone=ZoneId.systemDefault();
        LocalDate from=Instant.ofEpochMilli(now).atZone(displayZone).toLocalDate().minusDays(1),through=from.plusDays(74);long horizon=now+45L*86400000;
        JSONArray items=state.getJSONArray("items");
        for(int i=0;i<items.length();i++){
            JSONObject item=items.getJSONObject(i);if(item.optBoolean("completed"))continue;
            ZoneId zone=ZoneId.of(item.getString("timezone"));boolean all=item.getBoolean("allDay");
            LocalDateTime base=all?LocalDate.parse(item.getString("start")).atTime(9,0):Instant.parse(item.getString("start")).atZone(zone).toLocalDateTime();
            JSONObject recurrence=item.getJSONObject("recurrence"),exceptions=item.optJSONObject("exceptions");String until=recurrence.optString("until","");
            List<LocalDate> dates=RecurrenceDates.between(base.toLocalDate(),recurrence.getString("frequency"),recurrence.getInt("interval"),recurrence.optInt("count"),until.isEmpty()?null:LocalDate.parse(until),from,through);
            // Snoozed and moved occurrences may originate before the expansion window.
            if(exceptions!=null){java.util.Iterator<String> keys=exceptions.keys();while(keys.hasNext()){String key=keys.next();JSONObject ex=exceptions.optJSONObject(key);if(ex!=null&&(ex.has("snoozedUntil")||ex.has("start"))){LocalDate day=LocalDate.parse(key);if(!dates.contains(day))dates.add(day);}}}
            for(LocalDate date:dates){
                String occurrence=date.toString();JSONObject ex=exceptions!=null?exceptions.optJSONObject(occurrence):null;
                if(ex!=null&&(ex.optBoolean("completed")||ex.optBoolean("deleted")))continue;
                long due=RecurrenceDates.zoned(LocalDateTime.of(date,base.toLocalTime()),zone).toInstant().toEpochMilli();
                if(ex!=null&&ex.has("start"))due=all?LocalDate.parse(ex.getString("start")).atTime(9,0).atZone(zone).toInstant().toEpochMilli():Instant.parse(ex.getString("start")).toEpochMilli();
                String snooze=ex!=null?ex.optString("snoozedUntil",""):"";
                JSONArray offsets=snooze.isEmpty()?item.getJSONArray("alerts"):new JSONArray().put(0);
                for(int j=0;j<offsets.length();j++){
                    int minutes=offsets.getInt(j);long at=snooze.isEmpty()?due-minutes*60000L:Instant.parse(snooze).toEpochMilli();
                    if(at>now&&at<=horizon){
                        String key=item.getString("id")+":"+occurrence+":"+minutes;
                        if(closest.size()>=499&&(at>closest.peek().optLong("at")||(at==closest.peek().optLong("at")&&key.compareTo(closest.peek().optString("key"))>=0)))continue;
                        closest.add(new JSONObject().put("key",key).put("at",at).put("itemId",item.getString("id")).put("occurrence",occurrence).put("title",ex!=null?ex.optString("title",item.getString("title")):item.getString("title")).put("body","reminder".equals(item.getString("kind"))?"Reminder · Áring":"Calendar · Áring"));
                        if(closest.size()>499)closest.poll();
                    }
                }
            }
        }
        // Keep one additional alarm slot for the daily offline horizon refill.
        List<JSONObject> result=new ArrayList<>(closest);result.sort(order);return result;
    }
    static void reconcile(Context context) throws Exception {
        synchronized(AringState.LOCK){
            AlarmManager alarms=context.getSystemService(AlarmManager.class);
            android.database.sqlite.SQLiteDatabase db=AringState.db(context);
            db.execSQL("CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT UNIQUE NOT NULL)");
            JSONObject state=AringState.read(context);NotificationManager manager=context.getSystemService(NotificationManager.class);
            if(state.optJSONObject("user")==null)manager.cancelAll();
            else try(Cursor cursor=db.rawQuery("SELECT id,key FROM alerts",null)){
                while(cursor.moveToNext()){
                    String[] parts=cursor.getString(1).split(":");JSONObject item=AringState.find(state.getJSONArray("items"),"id",parts[0]);
                    JSONObject ex=item!=null&&item.optJSONObject("exceptions")!=null?item.getJSONObject("exceptions").optJSONObject(parts[1]):null;
                    if(item==null||item.optBoolean("completed")||(ex!=null&&(ex.optBoolean("completed")||ex.optBoolean("deleted"))))manager.cancel(cursor.getInt(0));
                }
            }
            JSONArray scheduled=new JSONArray(context.getSharedPreferences("alarms",0).getString("scheduled","[]"));
            for(int i=0;i<scheduled.length();i++)alarms.cancel(pending(context,scheduled.getInt(i),null));
            JSONArray next=new JSONArray();
            if(context.getSystemService(NotificationManager.class).areNotificationsEnabled())for(JSONObject alert:plan(AringState.read(context),System.currentTimeMillis())){
                db.execSQL("INSERT OR IGNORE INTO alerts(key) VALUES(?)",new Object[]{alert.getString("key")});int id;
                try(Cursor c=db.rawQuery("SELECT id FROM alerts WHERE key=?",new String[]{alert.getString("key")})){c.moveToFirst();id=c.getInt(0);}
                PendingIntent intent=pending(context,id,alert);long at=alert.getLong("at");
                if(Build.VERSION.SDK_INT<31||alarms.canScheduleExactAlarms())alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
                else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
                next.put(id);
            }
            context.getSharedPreferences("alarms",0).edit().putString("scheduled",next.toString()).commit();
            // Refill the finite horizon daily even when no server can be reached.
            Intent refill=new Intent(context,AringAlerts.class).setAction("com.example.aring.REFILL");
            PendingIntent refillIntent=PendingIntent.getBroadcast(context,0,refill,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,System.currentTimeMillis()+86400000L,refillIntent);
        }
    }
    @Override public void onReceive(Context context,Intent intent){
        PendingResult pendingResult=goAsync();new Thread(()->{
            try {
                String action=intent.getAction();
                if("com.example.aring.ALERT".equals(action)){
                    JSONObject alert=new JSONObject(intent.getStringExtra("alert"));JSONObject state=AringState.read(context);
                    JSONObject item=AringState.find(state.getJSONArray("items"),"id",alert.getString("itemId"));
                    JSONObject ex=item!=null&&item.optJSONObject("exceptions")!=null?item.getJSONObject("exceptions").optJSONObject(alert.getString("occurrence")):null;
                    boolean stillValid=false;
                    for(JSONObject candidate:plan(state,alert.getLong("at")-1))if(candidate.getString("key").equals(alert.getString("key"))&&candidate.getLong("at")==alert.getLong("at")){stillValid=true;break;}
                    if(stillValid&&item!=null&&!item.optBoolean("completed")&&(ex==null||(!ex.optBoolean("completed")&&!ex.optBoolean("deleted")))){
                        NotificationManager manager=context.getSystemService(NotificationManager.class);
                        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Calendar & reminders",NotificationManager.IMPORTANCE_HIGH));
                        if(Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED){
                            Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
                            PendingIntent content=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                            int id;try(Cursor c=AringState.db(context).rawQuery("SELECT id FROM alerts WHERE key=?",new String[]{alert.getString("key")})){id=c.moveToFirst()?c.getInt(0):1;}
                            manager.notify(id,new Notification.Builder(context,CHANNEL).setSmallIcon(com.example.aring.R.drawable.ic_stat_calendar).setContentTitle(alert.getString("title")).setContentText(alert.getString("body")).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(content).setAutoCancel(true).build());
                        }
                    }
                }
                reconcile(context);AringJobs.schedule(context);if(Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action))AringJobs.soon(context);
            } catch(Exception ignored){/* The app reports permissions and scheduling errors when opened. */}
            finally{pendingResult.finish();}
        },"aring-alerts").start();
    }
}
