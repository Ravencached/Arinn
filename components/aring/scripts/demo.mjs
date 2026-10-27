import { Store } from '../server/store.mjs';
import { createServer } from '../server/main.mjs';
import { randomUUID } from 'node:crypto';
import { today,addDays,toInstant } from '../shared/calendar.mjs';
const store=new Store();const alice=store.addUser('alice@example.test','alice','local-demo-aring-2026');const bob=store.addUser('bob@example.test','bob','local-demo-aring-2026');const family=store.family([alice.id,bob.id]);
const zone='America/New_York',date=today(zone);
for(const [title,kind,calendar,hour,day]of [['Morning walk','event',alice.calendarId,9,date],['Family dinner','event',family,18,date],['Water the plants','reminder',alice.calendarId,12,date],['Book the appointment','reminder',alice.calendarId,10,addDays(date,-1)],['A quiet Sunday','event',family,11,addDays(date,4)]]){
  const id=randomUUID();store.sync(alice.id,[{opId:randomUUID(),itemId:id,action:'put',baseRevision:0,item:{id,calendarId:calendar,title,kind,allDay:false,start:toInstant(`${day}T${String(hour).padStart(2,'0')}:00`,zone),end:toInstant(`${day}T${String(kind==='event'?hour+1:hour).padStart(2,'0')}:00`,zone),timezone:zone,recurrence:{frequency:kind==='event'?'weekly':'none',interval:1},alerts:kind==='reminder'?[0]:[15],exceptions:{},notes:'Synthetic demonstration data',location:kind==='event'?'Home':'',completed:false}}]);
}
const server=createServer(store,{origin:'http://127.0.0.1:4387'});server.listen(4387,'127.0.0.1',()=>console.log('Synthetic demo: http://127.0.0.1:4387 · alice@example.test or bob@example.test · password local-demo-aring-2026. Data disappears when the demo stops.'));
