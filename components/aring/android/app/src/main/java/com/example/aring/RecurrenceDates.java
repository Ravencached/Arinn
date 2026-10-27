package com.example.aring;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/** Calendar dates keep wall-clock time; invalid monthly/yearly dates are skipped. */
final class RecurrenceDates {
    static LocalDate at(LocalDate base,String frequency,int interval,int index){
        long step=(long)interval*index;
        switch(frequency){
            case "daily":return base.plusDays(step);
            case "weekly":return base.plusWeeks(step);
            case "monthly":{
                LocalDate month=base.withDayOfMonth(1).plusMonths(step);
                return month.lengthOfMonth()<base.getDayOfMonth()?null:month.withDayOfMonth(base.getDayOfMonth());
            }
            case "yearly":{
                LocalDate year=base.withDayOfMonth(1).plusYears(step);
                return year.lengthOfMonth()<base.getDayOfMonth()?null:year.withDayOfMonth(base.getDayOfMonth());
            }
            default:return index==0?base:null;
        }
    }
    static List<LocalDate> between(LocalDate base,String frequency,int interval,int count,LocalDate until,LocalDate from,LocalDate through){
        int first=0;
        if("daily".equals(frequency)||"weekly".equals(frequency))first=(int)Math.max(0,java.time.temporal.ChronoUnit.DAYS.between(base,from)/((long)interval*("weekly".equals(frequency)?7:1)));
        List<LocalDate> result=new ArrayList<>();int valid=first;
        for(int index=first;index<100000;index++){
            if(index>0&&"none".equals(frequency))break;
            LocalDate date=at(base,frequency,interval,index);if(date==null)continue;valid++;
            if((count>0&&valid>count)||(until!=null&&date.isAfter(until))||date.isAfter(through))break;
            if(!date.isBefore(from))result.add(date);
        }
        return result;
    }
    static ZonedDateTime zoned(LocalDateTime local,ZoneId zone){return local.atZone(zone);}
}
