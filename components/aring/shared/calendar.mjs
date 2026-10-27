import { Temporal } from '@js-temporal/polyfill';

export const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
export function today(zone = Temporal.Now.timeZoneId()) { return Temporal.Now.plainDateISO(zone).toString(); }
export function addDays(date, days) { return Temporal.PlainDate.from(date).add({days}).toString(); }
export function monthStart(date) { return Temporal.PlainDate.from(date).with({day: 1}).toString(); }
export function addMonths(date, months) { return Temporal.PlainDate.from(date).add({months}).toString(); }
export function weekday(date) { return Temporal.PlainDate.from(date).dayOfWeek; }
export function dateInZone(instant, zone) { return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate().toString(); }
export function endDateInZone(item, zone) {
  if(item.kind==='reminder')return item.allDay?item.start:dateInZone(item.start,zone);
  return item.allDay?addDays(item.end,-1):dateInZone(Temporal.Instant.from(item.end).subtract({nanoseconds:1}).toString(),zone);
}
export function toInstant(local, zone) { return Temporal.PlainDateTime.from(local).toZonedDateTime(zone, {disambiguation: 'compatible'}).toInstant().toString(); }
export function toLocal(instant, zone) { return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString().slice(0,16); }

export function validateItem(input, calendars) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid item');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)) throw new Error('Invalid item ID');
  const calendar = calendars.find(c => c.id === input.calendarId && c.role === 'editor');
  if (!calendar) throw new Error('Calendar unavailable');
  if (!['event','reminder'].includes(input.kind)) throw new Error('Invalid item type');
  if (input.kind === 'reminder' && calendar.type !== 'private') throw new Error('Reminders belong to your private calendar');
  const title = String(input.title || '').trim();
  if (!title || title.length > 200) throw new Error('Enter a title of up to 200 characters');
  const notes = String(input.notes || ''); const location = String(input.location || '');
  if (notes.length > 10000 || location.length > 500) throw new Error('Notes or location too long');
  if (typeof input.allDay !== 'boolean') throw new Error('Invalid all-day setting');
  const timezone = String(input.timezone || '');
  Temporal.Now.zonedDateTimeISO(timezone);
  let start, end;
  if (input.allDay) {
    start = Temporal.PlainDate.from(input.start).toString(); end = Temporal.PlainDate.from(input.end).toString();
    if (start >= end) throw new Error('End date must follow the start date');
  } else {
    start = Temporal.Instant.from(input.start).toString(); end = Temporal.Instant.from(input.end).toString();
    if (Temporal.Instant.compare(start,end) > 0 || (input.kind === 'event' && start === end)) throw new Error('End time must follow the start time');
  }
  if (Number(start.slice(0,4)) < 1970 || Number(start.slice(0,4)) > 2200 || Number(end.slice(0,4)) > 2200) throw new Error('Dates must be between 1970 and 2200');
  const r = input.recurrence || {frequency:'none',interval:1};
  if (!FREQUENCIES.includes(r.frequency) || !Number.isInteger(r.interval) || r.interval < 1 || r.interval > 365) throw new Error('Invalid recurrence');
  const recurrence = {frequency:r.frequency, interval:r.interval};
  if (r.until) { recurrence.until = Temporal.PlainDate.from(r.until).toString(); if (recurrence.until < (input.allDay ? start : dateInZone(start,timezone))) throw new Error('Recurrence end precedes start'); }
  if (r.count != null) { if (!Number.isInteger(r.count) || r.count < 1 || r.count > 10000) throw new Error('Invalid recurrence count'); recurrence.count = r.count; }
  const alerts = [...new Set(input.alerts || [])];
  if (alerts.length > 4 || alerts.some(n => !Number.isInteger(n) || n < 0 || n > 40320)) throw new Error('Invalid alert offset');
  const exceptions = {};
  if (Object.keys(input.exceptions || {}).length > 5000) throw new Error('Too many occurrence edits');
  for (const [key, value] of Object.entries(input.exceptions || {})) {
    const day = Temporal.PlainDate.from(key).toString();
    if (!value || typeof value !== 'object') throw new Error('Invalid exception');
    const ex = {deleted:value.deleted === true, completed:value.completed === true};
    if (value.snoozedUntil) ex.snoozedUntil = Temporal.Instant.from(value.snoozedUntil).toString();
    if (value.title) { ex.title = String(value.title).trim(); if (ex.title.length > 200) throw new Error('Exception title too long'); }
    if (value.start || value.end) {
      ex.start = input.allDay ? Temporal.PlainDate.from(value.start).toString() : Temporal.Instant.from(value.start).toString();
      ex.end = input.allDay ? Temporal.PlainDate.from(value.end).toString() : Temporal.Instant.from(value.end).toString();
      const order = input.allDay ? ex.start.localeCompare(ex.end) : Temporal.Instant.compare(ex.start,ex.end);
      if (order > 0 || (order === 0 && (input.kind === 'event' || input.allDay))) throw new Error('Invalid exception times');
    }
    exceptions[day] = ex;
  }
  const canonical={id:input.id,calendarId:calendar.id,kind:input.kind,title,notes,location,allDay:input.allDay,start,end,timezone,recurrence,alerts,exceptions,completed:input.completed === true};
  const keys=Object.keys(exceptions).sort();
  if(keys.length){
    const valid=new Set(occurrences({...canonical,exceptions:{}},keys[0],keys.at(-1),timezone).map(o=>o.occurrence));
    if(keys.some(k=>!valid.has(k)))throw new Error('Occurrence edits must belong to this recurrence');
  }
  return canonical;
}

// Recurrences retain the series' local start time. Monthly/yearly invalid dates
// are skipped, not clamped. Until is inclusive; all-day end is exclusive.
export function occurrences(item, from, through, displayZone = item.timezone) {
  const result = []; const r = item.recurrence || {frequency:'none',interval:1};
  const base = item.allDay ? Temporal.PlainDate.from(item.start) : Temporal.Instant.from(item.start).toZonedDateTimeISO(item.timezone).toPlainDateTime();
  const baseDate = item.allDay ? base : base.toPlainDate();
  const duration = item.allDay ? Temporal.PlainDate.from(item.start).until(Temporal.PlainDate.from(item.end)).days : Number(Temporal.Instant.from(item.end).epochMilliseconds - Temporal.Instant.from(item.start).epochMilliseconds);
  let initialIndex=0;
  if(r.frequency==='daily'||r.frequency==='weekly'){
    const earliest=Temporal.PlainDate.from(from).subtract({days:(item.allDay?duration:Math.ceil(duration/86400000))+2});
    initialIndex=Math.max(0,Math.floor(baseDate.until(earliest).days/(r.interval*(r.frequency==='weekly'?7:1))));
  }
  let validCount = initialIndex;
  for (let index = initialIndex; index < 100000; index++) {
    let local;
    try {
      if (index === 0) local = base;
      else if (r.frequency === 'none') break;
      else local = base.add({[({daily:'days',weekly:'weeks',monthly:'months',yearly:'years'})[r.frequency]]:index*r.interval}, {overflow:'reject'});
    } catch { continue; }
    validCount++;
    const day = (item.allDay ? local : local.toPlainDate()).toString();
    if (r.count && validCount > r.count) break;
    if (r.until && day > r.until) break;
    const exception = item.exceptions?.[day] || {};
    const start = exception.start || (item.allDay ? day : local.toZonedDateTime(item.timezone,{disambiguation:'compatible'}).toInstant().toString());
    const end = exception.end || (item.allDay ? addDays(start,duration) : Temporal.Instant.from(start).add({milliseconds:duration}).toString());
    const displayDate = item.allDay ? start : dateInZone(start,displayZone);
    const endDate = endDateInZone({...item,start,end},displayZone);
    if (!exception.deleted && displayDate <= through && endDate >= from) result.push({...item, ...exception, start,end, occurrence:day, displayDate, completed:exception.completed || item.completed});
    // Exceptions moved into the requested range are handled separately below.
    if (day > addDays(through,2)) break;
  }
  for (const [day,ex] of Object.entries(item.exceptions || {})) {
    if (!ex.start || ex.deleted || result.some(o=>o.occurrence===day)) continue;
    const displayDate = item.allDay ? ex.start : dateInZone(ex.start,displayZone);
    const endDate = endDateInZone({...item,start:ex.start,end:ex.end},displayZone);
    if (displayDate <= through && endDate >= from && day >= baseDate.toString()) result.push({...item,...ex,occurrence:day,displayDate,completed:ex.completed || item.completed});
  }
  return result;
}

export function notificationPlan(items, now = Date.now(), zone = Temporal.Now.timeZoneId(), horizonDays = 45) {
  const from = addDays(dateInZone(new Date(now).toISOString(),zone),-1), through = addDays(from,horizonDays+29);
  const plan = [];
  for (const item of items) {
    const expanded=occurrences(item,from,through,zone);
    for(const [day,ex]of Object.entries(item.exceptions||{})){
      if(ex.snoozedUntil&&!ex.deleted&&!expanded.some(o=>o.occurrence===day))expanded.push({...item,...ex,occurrence:day,completed:ex.completed||item.completed});
    }
    for (const o of expanded) {
      if (o.completed || o.deleted) continue;
      const due = o.allDay ? toInstant(o.start+'T09:00',o.timezone) : o.start;
      const offsets = o.snoozedUntil ? [0] : o.alerts;
      for (const minutes of offsets) {
        const at = o.snoozedUntil ? Date.parse(o.snoozedUntil) : Date.parse(due)-minutes*60000;
        if (at > now && at <= now+horizonDays*86400000) plan.push({key:`${o.id}:${o.occurrence}:${minutes}`,at,title:o.title,body:o.kind === 'reminder' ? 'Reminder · Áring' : 'Calendar · Áring',itemId:o.id,occurrence:o.occurrence});
      }
    }
  }
  return plan.sort((a,b)=>a.at-b.at).slice(0,500);
}

export function mergeSync(state, response, sent = []) {
  const acknowledged = new Set(response.results.filter(r=>r.status==='ok').map(r=>r.opId));
  const denied = new Set(response.results.filter(r=>r.status==='denied').map(r=>r.opId));
  const existingConflicts = state.conflicts || [];
  const newConflicts = response.results.filter(r=>r.status==='conflict' || r.status==='invalid').map(r=>{
    const old=sent.find(p=>p.opId===r.opId);
    const local=state.pending.find(p=>p.opId===r.opId)||state.pending.find(p=>p.itemId===old?.itemId)||old;
    return {...r,opId:local?.opId||r.opId,local};
  });
  const conflicted = new Set(newConflicts.map(c=>c.opId));
  const allowed = new Set(response.calendars.map(c=>c.id));
  const pending = state.pending.filter(p=>!acknowledged.has(p.opId) && !denied.has(p.opId) && !conflicted.has(p.opId) && allowed.has(p.item?.calendarId || p.calendarId));
  const conflicts = [...existingConflicts.filter(c=>allowed.has(c.local?.item?.calendarId || c.local?.calendarId)),...newConflicts];
  const items = response.items.slice();
  for (const p of pending) {
    const index = items.findIndex(i=>i.id===p.itemId);
    if (index>=0) items.splice(index,1);
    if (p.action!=='delete') items.push({...p.item,revision:p.baseRevision,pending:true});
  }
  return {...state,user:response.user,calendars:response.calendars,items,pending,conflicts,lastSync:new Date().toISOString(),status:denied.size ? 'Access changed; unauthorized queued changes were removed.' : conflicts.length ? 'Changes need your review.' : 'Synced'};
}
