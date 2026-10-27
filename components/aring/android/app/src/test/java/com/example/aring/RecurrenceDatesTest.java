package com.example.aring;
import org.junit.Test;
import static org.junit.Assert.*;
import java.time.*;
public class RecurrenceDatesTest {
    @Test public void monthlyDoesNotClamp(){assertNull(RecurrenceDates.at(LocalDate.parse("2026-01-31"),"monthly",1,1));assertEquals(LocalDate.parse("2026-03-31"),RecurrenceDates.at(LocalDate.parse("2026-01-31"),"monthly",1,2));}
    @Test public void leapDaySkipsInvalidYears(){assertNull(RecurrenceDates.at(LocalDate.parse("2024-02-29"),"yearly",1,1));assertEquals(LocalDate.parse("2028-02-29"),RecurrenceDates.at(LocalDate.parse("2024-02-29"),"yearly",1,4));}
    @Test public void springGapMovesForward(){assertEquals(Instant.parse("2026-03-08T07:30:00Z"),RecurrenceDates.zoned(LocalDateTime.parse("2026-03-08T02:30"),ZoneId.of("America/New_York")).toInstant());}
    @Test public void autumnOverlapUsesEarlierOffset(){assertEquals(Instant.parse("2026-11-01T05:30:00Z"),RecurrenceDates.zoned(LocalDateTime.parse("2026-11-01T01:30"),ZoneId.of("America/New_York")).toInstant());}
    @Test public void countIncludesOnlyValidDates(){assertEquals(java.util.List.of(LocalDate.parse("2026-01-31"),LocalDate.parse("2026-03-31")),RecurrenceDates.between(LocalDate.parse("2026-01-31"),"monthly",1,2,null,LocalDate.parse("2026-01-01"),LocalDate.parse("2026-12-31")));}
    @Test public void oldDailySeriesKeepCountWhenSkipping(){assertEquals(3,RecurrenceDates.between(LocalDate.parse("1970-01-01"),"daily",1,0,null,LocalDate.parse("2026-10-14"),LocalDate.parse("2026-10-16")).size());assertEquals(0,RecurrenceDates.between(LocalDate.parse("1970-01-01"),"daily",1,3,null,LocalDate.parse("2026-10-14"),LocalDate.parse("2026-10-16")).size());}
}
