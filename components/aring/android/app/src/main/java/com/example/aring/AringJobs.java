package com.example.aring;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AringJobs extends JobService {
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    static void schedule(Context context){
        JobScheduler scheduler=context.getSystemService(JobScheduler.class);
        scheduler.schedule(new JobInfo.Builder(1401,new ComponentName(context,AringJobs.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000L).setPersisted(true).build());
    }
    static void soon(Context context){
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(1402,new ComponentName(context,AringJobs.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1000).build());
    }
    @Override public boolean onStartJob(JobParameters params){executor.execute(()->{boolean retry=false;try{AringSync.sync(this);}catch(Exception ignored){retry=true;}jobFinished(params,retry);});return true;}
    @Override public boolean onStopJob(JobParameters params){return true;}
    @Override public void onDestroy(){executor.shutdown();super.onDestroy();}
}
