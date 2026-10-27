import { today,addDays,monthStart,addMonths,weekday,toInstant,toLocal,dateInZone,endDateInZone,occurrences,validateItem } from '../shared/calendar.mjs';
import { storage,native,bridge,emptyState,onStateChange } from './storage.mjs';

const $=s=>document.querySelector(s);const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let zone=Intl.DateTimeFormat().resolvedOptions().timeZone,lastToday=today(zone);
let state=emptyState(),view='today',focus=lastToday,busy=false,editing=null,notifications='',renderedUserId=null;
const formatDate=(date,options)=>new Intl.DateTimeFormat(undefined,{timeZone:'UTC',...options}).format(new Date(date+'T12:00:00Z'));
const dayLabel=date=>formatDate(date,{weekday:'long',month:'long',day:'numeric'});
const timeLabel=o=>o.allDay?'All day':new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(o.start));
const visibleItems=()=>state.items.filter(i=>state.visibility[i.calendarId]!==false);
const calendarFor=id=>state.calendars.find(c=>c.id===id);
const calendarClass=id=>calendarFor(id)?.type==='family'?'family':'';
const isLocal=()=>state.user?.id==='local-only';
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',4500);}
async function request(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok){const error=new Error(data.error||'Synchronization failed');error.status=r.status;throw error;}return data;}

function loginScreen(){
  $('#app').innerHTML=`<main class="login"><img src="/logo.png" alt="Áring squirrel and calendar"><p class="eyebrow">A Ratataskr companion</p><h1>A little room for your day.</h1><p class="muted">Your calendar and reminders, together.<br>Sign in to keep your devices in step.</p><form id="login-form"><label><span>Email</span><input name="email" type="email" autocomplete="username" required></label><label><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><p class="form-error" id="login-error" role="alert"></p><button class="primary" type="submit">Sign in</button></form><button id="local-mode">Use on this device for now</button><p class="muted">Device-only mode saves locally and has no account or synchronization. Accounts are created privately by your administrator.</p></main>`;
  if(native)$('#login-form').insertAdjacentHTML('afterbegin','<label><span>Calendar connection</span><select name="connection"><option value="public">calendar.example.test</option><option value="private">calendar-host · private</option></select></label><p class="muted">The private calendar-host connection requires Tailscale and the administrator HTTPS setup.</p>');
  $('#login-form').onsubmit=async e=>{e.preventDefault();const form=e.target;form.querySelector('button').disabled=true;try{
    const email=form.elements.email.value,password=form.elements.password.value;
    const response=native?(await bridge.login({email,password,connection:form.elements.connection.value})).state:await request('/api/login',{email,password});
    state=native?response:{...emptyState(),...response,status:'Synced',lastSync:new Date().toISOString()};
    if(!native)await storage.replace(state);focus=today(zone);render();await schedule();
  }catch(error){$('#login-error').textContent=error.message;}finally{if(document.contains(form))form.querySelector('button').disabled=false;}};
  $('#local-mode').onclick=async()=>{
    const prior=await storage.read();
    if(prior.user){state=prior;render();return;}
    state={...emptyState(),user:{id:'local-only',name:'Your',email:''},calendars:[{id:'local-private',name:'My calendar',type:'private',role:'editor'}],status:'Saved on this device · synchronization is off'};
    await storage.replace(state);render();
  };
}
function render(){
  if(renderedUserId!==(state.user?.id||null)){
    for(const id of ['editor','settings']){const dialog=$('#'+id);if(dialog.open)dialog.close();dialog.innerHTML='';}
    editing=null;renderedUserId=state.user?.id||null;
  }
  const nextZone=Intl.DateTimeFormat().resolvedOptions().timeZone,nextDay=today(nextZone);
  if(focus===lastToday)focus=nextDay;
  zone=nextZone;lastToday=nextDay;
  if(!state.user)return loginScreen();
  const currentDay=today(zone),warning=state.pending.length||state.conflicts.length||(!isLocal()&&(!navigator.onLine||/failed|required|unavailable|changed/i.test(state.status)));
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><img src="/logo.png" alt="Áring"><p>A RATATASKR COMPANION</p></div><nav class="navigation" aria-label="Calendar views">${['today','month','week','agenda'].map(v=>`<button data-view="${v}" class="${view===v?'active':''}" ${view===v?'aria-current="page"':''}>${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}<button data-settings>Settings</button></nav><div class="calendar-controls"><p class="eyebrow">Your calendars</p>${toggles()}</div><footer><p class="muted">${escape(state.user.name)}<br>${escape(state.user.email||'Device-only calendar')}</p><button data-settings>Account & alerts</button></footer></aside><main class="workspace"><div class="mobile-brand">ÁRING · RATATASKR</div><header class="topbar"><div><p class="eyebrow">${view==='today'?escape(formatDate(focus,{weekday:'long',month:'long',day:'numeric'})):'Make room for what matters'}</p><h1>${view==='today'?(focus===currentDay?'Today':escape(dayLabel(focus))):view[0].toUpperCase()+view.slice(1)}</h1></div><div class="top-actions"><button id="add-reminder">+ Reminder</button><button id="add-event" class="primary">+ Event</button></div></header><div class="sync-strip ${warning?'warning':''}" role="status"><span>${escape(isLocal()?'Saved on this device · synchronization is off':state.status)}${state.pending.length&&!isLocal()?` · ${state.pending.length} pending`:''}${state.lastSync&&!isLocal()?` · Last sync ${escape(new Date(state.lastSync).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}`:''}</span>${!isLocal()?`<button id="sync" ${busy?'disabled':''}>${busy?'Syncing…':'Sync now'}</button>`:''}${state.conflicts.length?'<button id="review">Review</button>':''}</div>${view==='today'?todayView():view==='month'?monthView():view==='week'?weekView():agendaView()}</main></div>`;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
  document.querySelectorAll('[data-settings]').forEach(b=>b.onclick=settings);
  document.querySelectorAll('[data-visible]').forEach(c=>c.onchange=async()=>{state=await storage.visibility(c.dataset.visible,c.checked,state.user.id);render();});
  $('#add-event').onclick=()=>editor(null,'event');$('#add-reminder').onclick=()=>editor(null,'reminder');
  if($('#sync'))$('#sync').onclick=sync;if($('#review'))$('#review').onclick=settings;
  document.querySelectorAll('[data-shift]').forEach(b=>b.onclick=()=>{focus=view==='month'?addMonths(focus,Number(b.dataset.shift)):addDays(focus,Number(b.dataset.shift)*(view==='week'?7:view==='agenda'?30:1));render();});
  document.querySelectorAll('[data-now]').forEach(b=>b.onclick=()=>{focus=today(zone);render();});
  document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{focus=b.dataset.day;view='today';render();});
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const item=state.items.find(i=>i.id===b.dataset.open);const o=occurrences(item,addDays(b.dataset.occ,-5),addDays(b.dataset.occ,5),zone).find(o=>o.occurrence===b.dataset.occ)||{...item,occurrence:b.dataset.occ};editor(o,item.kind);});
  document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>complete(b.dataset.complete,b.dataset.occ));
  document.querySelectorAll('[data-snooze]').forEach(b=>b.onclick=()=>snooze(b.dataset.snooze,b.dataset.occ));
}
function toggles(){return state.calendars.map(c=>`<label class="calendar-toggle"><input type="checkbox" data-visible="${escape(c.id)}" ${state.visibility[c.id]!==false?'checked':''}><span class="dot ${c.type==='family'?'family':''}"></span>${escape(c.name)}</label>`).join('');}
function nav(){return `<div class="date-nav"><button data-shift="-1" aria-label="Previous period">‹</button><button data-now>Today</button><button data-shift="1" aria-label="Next period">›</button></div>`;}
function sorted(from,through){return visibleItems().flatMap(i=>occurrences(i,from,through,zone)).sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title));}
function entry(o){return `<div class="entry ${o.completed?'completed':''}"><div class="entry-time">${escape(timeLabel(o))}</div><div class="entry-main"><button class="entry-title" data-open="${o.id}" data-occ="${o.occurrence}">${escape(o.title)}</button><div class="muted"><span class="dot ${calendarClass(o.calendarId)}"></span> ${escape(calendarFor(o.calendarId)?.name)}${o.location?` · ${escape(o.location)}`:''}${o.pending?' · Saved locally':''}${o.recurrence.frequency!=='none'?' · Repeats':''}${o.snoozedUntil?` · Snoozed until ${escape(new Date(o.snoozedUntil).toLocaleString())}`:''}</div></div>${o.kind==='reminder'?`<div class="entry-actions"><button data-complete="${o.id}" data-occ="${o.occurrence}">${o.completed?'Undo':'Done'}</button>${!o.completed?`<button data-snooze="${o.id}" data-occ="${o.occurrence}">Snooze 15m</button>`:''}</div>`:''}</div>`;}
function empty(message){return `<div class="empty"><strong>${escape(message)}</strong><br>A little breathing room.</div>`;}
function todayView(){
  const list=sorted(focus,focus);const appointments=list.filter(o=>o.kind==='event'),reminders=list.filter(o=>o.kind==='reminder');
  const overdue=sorted(addDays(focus,-366),addDays(focus,-1)).filter(o=>o.kind==='reminder'&&!o.completed && (!o.snoozedUntil||Date.parse(o.snoozedUntil)<Date.now()));
  return `<div class="section-head"><h2>${focus===today(zone)?'Your day, at a glance':'At a glance'}</h2>${nav()}</div><div class="today-grid"><section class="panel"><div class="summary"><div><div class="stat">${appointments.length}</div><div class="stat-label">appointments</div></div><div><div class="stat">${reminders.filter(o=>!o.completed).length}</div><div class="stat-label">reminders due</div></div></div><h2>On the calendar</h2>${appointments.length?appointments.map(entry).join(''):empty('No appointments today')}</section><section class="panel"><h2>Reminders</h2>${reminders.length?reminders.map(entry).join(''):empty('Nothing due today')}${overdue.length?`<h3 class="overdue">Overdue · ${overdue.length}</h3>${overdue.map(o=>`<p class="muted overdue">${escape(dayLabel(o.displayDate))}</p>${entry(o)}`).join('')}`:''}<p class="muted">${escape(notifications||'Alerts are delivered locally by the Android app.')}<br>Overdue list covers the previous year; older items remain in Agenda.</p></section></div>`;
}
function chip(o){return `<button class="calendar-item ${calendarClass(o.calendarId)} ${o.kind} ${o.completed?'completed':''}" data-open="${o.id}" data-occ="${o.occurrence}" title="${escape(o.title)}">${o.allDay?'':escape(timeLabel(o))+' '}${escape(o.title)}</button>`;}
function monthView(){const first=monthStart(focus),begin=addDays(first,-(weekday(first)%7));const end=addDays(begin,41),list=sorted(begin,end);return `<div class="section-head"><h2>${escape(formatDate(first,{month:'long',year:'numeric'}))}</h2>${nav()}</div><div class="month">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="weekday">${d}</div>`).join('')}${Array.from({length:42},(_,i)=>{const day=addDays(begin,i);return `<div class="day ${day.slice(0,7)!==first.slice(0,7)?'outside':''}"><button class="day-number ${day===today(zone)?'current':''}" data-day="${day}" aria-label="${escape(dayLabel(day))}">${Number(day.slice(8))}</button>${list.filter(o=>o.displayDate<=day&&endDateInZone(o,zone)>=day).slice(0,4).map(chip).join('')}${list.filter(o=>o.displayDate===day).length>4?`<button class="calendar-item" data-day="${day}">View all</button>`:''}</div>`;}).join('')}</div>`;}
function weekView(){const begin=addDays(focus,-weekday(focus)%7),end=addDays(begin,6),list=sorted(begin,end);return `<div class="section-head"><h2>${escape(formatDate(begin,{month:'short',day:'numeric'}))} – ${escape(formatDate(end,{month:'short',day:'numeric'}))}</h2>${nav()}</div><div class="week">${Array.from({length:7},(_,i)=>{const day=addDays(begin,i);return `<section class="week-day"><h3><button data-day="${day}">${escape(formatDate(day,{weekday:'short',day:'numeric'}))}</button></h3>${list.filter(o=>o.displayDate<=day&&endDateInZone(o,zone)>=day).map(chip).join('')}</section>`;}).join('')}</div>`;}
function agendaView(){const end=addDays(focus,29),list=sorted(focus,end);return `<div class="section-head"><h2>Next 30 days</h2>${nav()}</div><p class="muted">${escape(dayLabel(focus))} — ${escape(dayLabel(end))}</p>${list.length?[...new Set(list.map(o=>o.displayDate))].map(day=>`<section class="agenda-day"><h3>${escape(dayLabel(day))}</h3>${list.filter(o=>o.displayDate===day).map(entry).join('')}</section>`).join(''):empty('No plans in this period')}<label class="muted">Go to date <input id="agenda-date" type="date" value="${focus}"></label>`;}

function editor(o,kind){
  const original=o?state.items.find(i=>i.id===o.id):null;editing={original,occurrence:o?.occurrence};
  const item=original||{kind,title:'',calendarId:state.calendars.find(c=>c.type==='private').id,allDay:false,start:toInstant(focus+'T09:00',zone),end:toInstant(focus+(kind==='reminder'?'T09:00':'T10:00'),zone),timezone:zone,recurrence:{frequency:'none',interval:1},alerts:kind==='reminder'?[0]:[],notes:'',location:''};
  const d=$('#editor');d.innerHTML=`<h2>${original?'Edit':'New'} ${kind}</h2><form id="edit-form"><div class="form-grid"><label class="wide"><span>Title</span><input name="title" value="${escape(item.title)}" maxlength="200" required autofocus></label><label><span>Calendar</span><select name="calendarId">${state.calendars.filter(c=>c.role==='editor'&&(kind==='event'||c.type==='private')).map(c=>`<option value="${c.id}" ${c.id===item.calendarId?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label><label class="checkbox"><input name="allDay" type="checkbox" ${item.allDay?'checked':''}><span>All day</span></label><label><span>${kind==='reminder'?'Due':'Starts'}</span><input name="start" type="${item.allDay?'date':'datetime-local'}" value="${item.allDay?item.start:toLocal(item.start,item.timezone)}" required></label><label><span>${item.allDay?'Ends (exclusive)':kind==='reminder'?'Due (same time)':'Ends'}</span><input name="end" type="${item.allDay?'date':'datetime-local'}" value="${item.allDay?item.end:toLocal(item.end,item.timezone)}" required></label><label><span>Time zone</span><input name="timezone" value="${escape(item.timezone)}" required></label><label><span>Alert before</span><select name="alert">${[[-1,'No alert'],[0,'At due / start time'],[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[1440,'1 day']].map(([n,t])=>`<option value="${n}" ${(item.alerts[0]??-1)===n?'selected':''}>${t}</option>`).join('')}</select></label><label><span>Repeat</span><select name="frequency">${['none','daily','weekly','monthly','yearly'].map(v=>`<option ${item.recurrence.frequency===v?'selected':''}>${v}</option>`).join('')}</select></label><label><span>Every (interval)</span><input name="interval" type="number" min="1" max="365" value="${item.recurrence.interval}"></label><label><span>Repeat until (optional)</span><input name="until" type="date" value="${item.recurrence.until||''}"></label><label><span>Occurrence count (optional)</span><input name="count" type="number" min="1" max="10000" value="${item.recurrence.count||''}"></label>${original&&item.recurrence.frequency!=='none'?`<label class="wide"><span>Apply changes to</span><select name="scope"><option value="series">Entire series</option><option value="occurrence">Only ${escape(o.occurrence)} (title, time or deletion)</option></select></label>`:''}<label class="wide"><span>Location</span><input name="location" maxlength="500" value="${escape(item.location)}"></label><label class="wide"><span>Notes</span><textarea name="notes" maxlength="10000">${escape(item.notes)}</textarea></label></div><p class="muted">All-day alerts arrive at 9 AM in the event’s time zone. Repeating dates retain local time; invalid month dates are skipped.</p><p class="form-error" id="edit-error" role="alert"></p><div class="form-actions">${original?'<button type="button" id="delete-item" class="danger">Delete</button>':''}<button type="button" id="cancel-edit">Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  d.showModal();const f=$('#edit-form');$('#cancel-edit').onclick=()=>d.close();
  if(original)f.elements.calendarId.disabled=true;
  f.elements.allDay.onchange=()=>{const all=f.elements.allDay.checked;for(const name of ['start','end']){const input=f.elements[name],day=input.value.slice(0,10)||focus;input.type=all?'date':'datetime-local';input.value=all?(name==='end'?addDays(f.elements.start.value,1):day):day+(name==='end'&&kind==='event'?'T10:00':'T09:00');}};
  if(f.elements.scope)f.elements.scope.onchange=()=>{if(f.elements.scope.value==='occurrence'){f.elements.title.value=o.title;f.elements.start.value=o.allDay?o.start:toLocal(o.start,item.timezone);f.elements.end.value=o.allDay?o.end:toLocal(o.end,item.timezone);}};
  f.onsubmit=async e=>{e.preventDefault();try{
    const allDay=f.elements.allDay.checked,tz=f.elements.timezone.value;
    const start=allDay?f.elements.start.value:toInstant(f.elements.start.value,tz);let end=allDay?f.elements.end.value:toInstant(f.elements.end.value,tz);
    if(kind==='reminder')end=allDay?addDays(start,1):start;
    const recurrence={frequency:f.elements.frequency.value,interval:Number(f.elements.interval.value)};
    if(f.elements.until.value)recurrence.until=f.elements.until.value;if(f.elements.count.value)recurrence.count=Number(f.elements.count.value);
    let next={...item,id:original?.id||crypto.randomUUID(),title:f.elements.title.value,calendarId:f.elements.calendarId.value,allDay,start,end,timezone:tz,recurrence,alerts:Number(f.elements.alert.value)<0?[]:[Number(f.elements.alert.value)],notes:f.elements.notes.value,location:f.elements.location.value,exceptions:item.exceptions||{}};
    if(f.elements.scope?.value==='occurrence'){
      if(allDay!==item.allDay||tz!==item.timezone)throw new Error('Change all-day or time-zone settings on the entire series');
      next={...item,exceptions:{...item.exceptions,[o.occurrence]:{...item.exceptions?.[o.occurrence],title:next.title,start,end}}};
    }
    next=validateItem(next,state.calendars);await mutate({action:'put',itemId:next.id,item:next,baseRevision:original?.revision??0});d.close();
  }catch(error){const errorField=$('#edit-error');if(errorField)errorField.textContent=error.message;else toast(error.message);}};
  if($('#delete-item'))$('#delete-item').onclick=async()=>{try{
    if(f.elements.scope?.value==='occurrence'){const next={...item,exceptions:{...item.exceptions,[o.occurrence]:{...item.exceptions?.[o.occurrence],deleted:true}}};await mutate({action:'put',itemId:item.id,item:next});}
    else await mutate({action:'delete',itemId:item.id,calendarId:item.calendarId,baseRevision:original.revision});d.close();
  }catch(error){const errorField=$('#edit-error');if(errorField)errorField.textContent=error.message;else toast(error.message);}};
}
async function mutate(mutation){if(mutation.baseRevision==null)mutation.baseRevision=state.items.find(i=>i.id===mutation.itemId)?.revision??0;state=await storage.mutate(mutation,state.user.id);render();await schedule();if(!isLocal())void sync();}
async function complete(id,day){const item=state.items.find(i=>i.id===id);const current=item.exceptions?.[day]?.completed||item.completed;let next;if(item.recurrence.frequency==='none')next={...item,completed:!current};else next={...item,exceptions:{...item.exceptions,[day]:{...item.exceptions?.[day],completed:!current,snoozedUntil:null}}};await mutate({action:'put',itemId:id,item:validateItem(next,state.calendars)});}
async function snooze(id,day){const item=state.items.find(i=>i.id===id);const next={...item,exceptions:{...item.exceptions,[day]:{...item.exceptions?.[day],completed:false,snoozedUntil:new Date(Date.now()+15*60000).toISOString()}}};await mutate({action:'put',itemId:id,item:validateItem(next,state.calendars)});toast('Snoozed for 15 minutes');}
async function schedule(){if(!native)return;try{const result=await bridge.notifications({request:false});notifications=result.message;}catch(error){notifications='Alert scheduling needs attention: '+error.message;}}
async function sync(){
  if(busy||!state.user||isLocal())return;busy=true;render();
  const syncingUser=state.user.id;
  try{
    if(native)state=(await bridge.sync()).state;
    else{
      const latest=await storage.read();if(latest.user?.id!==syncingUser){state=latest;return;}
      const sent=(latest.inFlight?.length?latest.inFlight:latest.pending).slice(0,100),marked=await storage.markSending(sent,latest.user.id);if(marked.user?.id!==syncingUser){state=marked;return;}
      const response=await request('/api/sync',{operations:sent,expectedUserId:syncingUser});state=await storage.applySync(response,sent,latest.user.id);
    }
    await schedule();
  }catch(error){
    // Native sync records its specific authentication/connection failure in the
    // shared database; keep that message instead of masking expiry as a network error.
    state=native?await storage.read():await storage.status(error.status===409?'Account changed in another window. Sign in again to resume.':error.status===401?'Sign in required to resume synchronization. Your local changes are saved.':navigator.onLine?'Synchronization failed. Your local changes are saved.':'Offline. Your local changes are saved.',syncingUser);
  }
  finally{busy=false;render();if(state.pending.length&&state.status==='Synced')setTimeout(()=>void sync(),0);}
}
async function settings(){
  const settingsUser=state.user.id;
  const d=$('#settings');d.innerHTML=`<h2>Account & alerts</h2><div class="settings-stack"><div><strong>${escape(state.user.name)}</strong><p class="muted">${escape(state.user.email||'Device-only mode')} · ${escape(zone)}</p></div><div><p class="eyebrow">Calendar visibility</p>${toggles()}</div><div><p class="eyebrow">Notifications</p><p class="muted">${escape(native?notifications:'Install the Android app for alerts when the app is closed. Desktop currently provides calendar access without background alerts.')}</p>${native?'<button id="enable-alerts">Enable notifications</button><button id="alarm-settings">Alarm permission</button>':''}</div><div><p class="eyebrow">Changes needing review</p>${state.conflicts.length?state.conflicts.map(c=>`<div class="conflict"><strong>${escape(c.local?.item?.title||'Deleted item')}</strong><p class="muted">${escape(c.message)}${c.current?` · Server version: ${escape(c.current.title)}`:' · Server item was deleted or unavailable'}</p><button data-resolve="${c.opId}" data-keep="false">Use server version</button><button data-resolve="${c.opId}" data-keep="true">${c.current?'Keep my version':'Save mine as a new item'}</button></div>`).join(''):'<p class="muted">No conflicts.</p>'}</div><div><button id="export">Export this device’s calendar data</button><p class="muted">Export includes your visible and hidden calendar records, pending edits and conflicts. Store the downloaded file privately.</p></div><div id="devices"></div><div>${!isLocal()?'<button id="reauth">Sign in again</button>':''}<button id="signout" class="danger">${isLocal()?'Clear device-only data':'Sign out & clear this device'}</button><p class="muted">${state.pending.length?'Export pending changes before signing out; sign-out removes local data.':''}</p></div></div><div class="form-actions"><button id="close-settings">Close</button></div>`;d.showModal();
  $('#close-settings').onclick=()=>d.close();
  $('#export').parentElement.insertAdjacentHTML('beforeend','<label><span>Import JSON as new private calendar copies</span><input id="import-json" type="file" accept="application/json,.json"></label>');
  d.querySelectorAll('[data-visible]').forEach(c=>c.onchange=async()=>{state=await storage.visibility(c.dataset.visible,c.checked,state.user.id);render();});
  if($('#enable-alerts'))$('#enable-alerts').onclick=async()=>{try{const r=await bridge.notifications({request:true});notifications=r.message;toast(r.message);}catch(error){toast(error.message);}};
  if($('#alarm-settings'))$('#alarm-settings').onclick=()=>bridge.alarmSettings().catch(error=>toast(error.message));
  d.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{state=await storage.resolve(b.dataset.resolve,b.dataset.keep==='true',state.user.id);d.close();render();await schedule();void sync();});
  $('#export').onclick=async()=>{
    if(native){try{const result=await bridge.exportData();if(result.ok)toast('Calendar export saved');}catch(error){toast(error.message);}return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`aring-${today(zone)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  $('#import-json').onchange=async event=>{try{
    const file=event.target.files[0];if(!file)return;if(file.size>4*1024*1024)throw new Error('Choose a JSON export smaller than 4 MiB');
    const data=JSON.parse(await file.text()),source=Array.isArray(data)?data:data.items;
    if(!Array.isArray(source)||source.length>5000)throw new Error('Export must contain an items array of up to 5,000 entries');
    const privateCalendar=state.calendars.find(c=>c.type==='private'&&c.role==='editor');
    const items=source.map(item=>validateItem({...item,id:crypto.randomUUID(),calendarId:privateCalendar.id},state.calendars));
    if(!confirm(`Import ${items.length} items as new private copies? This can create duplicates if you import the same file twice.`))return;
    state=await storage.importItems(items,state.user.id);d.close();render();await schedule();toast(`${items.length} private copies imported`);if(!isLocal())void sync();
  }catch(error){toast(error.message);}};
  $('#signout').onclick=async()=>{
    const signedOutUser=state.user.id,latest=await storage.read();
    if(latest.user?.id!==signedOutUser){state=latest;d.close();render();toast('Account changed in another window');return;}
    state=latest;
    if(!confirm(state.pending.length?'Clear this device, including pending edits? Export them first if you need them.':'Clear calendar data from this device and sign out?'))return;
    try{if(native)await bridge.logout();else if(!isLocal())await request('/api/logout',{expectedUserId:signedOutUser});}catch(error){if(error.status===409){state=await storage.read();d.close();render();toast('Account changed in another window');return;}toast('Remote session could not be revoked. Revoke this device after signing in again.');}
    state=await storage.clear(signedOutUser);d.close();render();
  };
  if($('#reauth'))$('#reauth').onclick=()=>{
    const preserved=state;d.close();loginScreen();$('#local-mode').hidden=true;
    const form=$('#login-form');form.elements.email.value=preserved.user.email;
    form.onsubmit=async e=>{e.preventDefault();try{
      if(form.elements.email.value.trim().toLowerCase()!==preserved.user.email.toLowerCase())throw new Error('Use the same account to preserve pending changes');
      const result=native?(await bridge.reauthenticate({email:form.elements.email.value,password:form.elements.password.value})).state:await request('/api/login',{email:form.elements.email.value,password:form.elements.password.value});
      if(result.user.id!==preserved.user.id)throw new Error('Use the same account to preserve these pending changes');
      state=native?result:await storage.reauthenticate(result);render();await sync();
    }catch(error){$('#login-error').textContent=error.message;}};
  };
  if(!isLocal())try{
    const response=native?await bridge.devices():await request('/api/devices');
    if(!d.open || state.user?.id!==settingsUser)return;$('#devices').innerHTML=`<p class="eyebrow">Signed-in devices</p>${response.devices.map(device=>`<div class="device"><div>${escape(device.device)} ${device.current?'(this session)':''}<br><span class="muted">Expires ${escape(new Date(device.expires).toLocaleDateString())}</span></div><button data-revoke="${device.id}">Revoke</button></div>`).join('')}`;
    d.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{try{if(native)await bridge.revoke({id:b.dataset.revoke});else await request('/api/revoke',{id:b.dataset.revoke});b.disabled=true;b.textContent='Revoked';}catch(error){toast(error.message);}});
  }catch{if($('#devices'))$('#devices').innerHTML='<p class="muted">Reconnect to manage signed-in devices.</p>';}
}

document.addEventListener('change',e=>{if(e.target.id==='agenda-date'&&e.target.value){focus=e.target.value;render();}});
onStateChange(async()=>{state=await storage.read();render();});
window.addEventListener('unhandledrejection',event=>toast(event.reason?.message||'This change could not be saved. Please try again.'));
window.addEventListener('online',()=>void sync());window.addEventListener('offline',async()=>{if(state.user&&!isLocal()){state=await storage.status('Offline. Your local changes are saved.');render();}});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){state=await storage.read();await schedule();render();void sync();}});
setInterval(()=>void sync(),60000);
try{state=await storage.read();await schedule();render();if(state.user)void sync();}catch(error){$('#app').innerHTML='<main class="login"><h1>Storage needs attention</h1><p>Áring could not open its local database. Enable storage for this app and reopen it.</p></main>';console.error(error);}
if(!native&&'serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
