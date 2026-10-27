import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/main.mjs';
const payload=(id,calendarId,title='Appointment')=>({id,calendarId,kind:'event',title,notes:'',location:'',allDay:true,start:'2026-10-14',end:'2026-10-15',timezone:'America/New_York',recurrence:{frequency:'none',interval:1},alerts:[],exceptions:{},completed:false});
const put=(calendarId,id=randomUUID(),baseRevision=0,title)=>({opId:randomUUID(),itemId:id,action:'put',baseRevision,item:payload(id,calendarId,title)});
function fixture(){const store=new Store();const alice=store.addUser('alice@example.test','alice','synthetic-test-password');const bob=store.addUser('bob@example.test','bob','synthetic-test-password');const family=store.family([alice.id,bob.id]);return {store,alice,bob,family};}
test('server enforces private account isolation, including guessable item IDs',()=>{const {store,alice,bob}=fixture();try{const op=put(alice.calendarId);store.sync(alice.id,[op]);assert.equal(store.snapshot(bob.id).items.length,0);const denial=store.sync(bob.id,[{...op,opId:randomUUID(),baseRevision:1}]);assert.equal(denial.results[0].status,'denied');assert.equal(denial.results[0].current,undefined);assert.equal(store.snapshot(alice.id).items[0].revision,1);}finally{store.close();}});
test('Family grants explicit shared editing and rejects unauthorized calendar moves',()=>{const {store,alice,bob,family}=fixture();try{const op=put(family);store.sync(alice.id,[op]);const changed=put(family,op.itemId,1,'Family edited');assert.equal(store.sync(bob.id,[changed]).results[0].status,'ok');assert.equal(store.snapshot(alice.id).items[0].title,'Family edited');const moved=put(bob.calendarId,op.itemId,2);assert.equal(store.sync(bob.id,[moved]).results[0].status,'denied');}finally{store.close();}});
test('offline conflicts are explicit and retry receipts are idempotent',()=>{const {store,alice}=fixture();try{const initial=put(alice.calendarId);const first=store.sync(alice.id,[initial]);assert.equal(store.sync(alice.id,[initial]).results[0].revision,1);assert.equal(store.snapshot(alice.id).items[0].revision,1);store.sync(alice.id,[put(alice.calendarId,initial.itemId,1,'Laptop edit')]);const phone=store.sync(alice.id,[put(alice.calendarId,initial.itemId,1,'Phone offline edit')]);assert.equal(phone.results[0].status,'conflict');assert.equal(phone.results[0].current.title,'Laptop edit');assert.equal(first.items[0].revision,1);}finally{store.close();}});
test('receipt replay after revoked membership never leaks a record',()=>{const {store,alice,bob,family}=fixture();try{const op=put(family);store.sync(bob.id,[op]);store.db.prepare('DELETE FROM memberships WHERE user_id=? AND calendar_id=?').run(bob.id,family);const result=store.sync(bob.id,[op]);assert.equal(result.results[0].status,'denied');assert.equal(result.items.length,0);assert.equal(result.calendars.some(c=>c.id===family),false);}finally{store.close();}});
test('tombstones prevent stale offline resurrection',()=>{const {store,alice}=fixture();try{const initial=put(alice.calendarId);store.sync(alice.id,[initial]);store.sync(alice.id,[{opId:randomUUID(),itemId:initial.itemId,calendarId:alice.calendarId,action:'delete',baseRevision:1}]);const stale=store.sync(alice.id,[put(alice.calendarId,initial.itemId,1)]);assert.equal(stale.results[0].status,'conflict');assert.equal(stale.results[0].current,null);assert.equal(stale.items.length,0);}finally{store.close();}});
test('database survives restart',async()=>{const dir=await mkdtemp(join(tmpdir(),'aring-'));let store=new Store(join(dir,'state.sqlite'));try{const user=store.addUser('restore@example.test','Restore','synthetic-test-password');store.sync(user.id,[put(user.calendarId)]);store.close();store=new Store(join(dir,'state.sqlite'));assert.equal(store.snapshot(user.id).items.length,1);}finally{store.close();await rm(dir,{recursive:true,force:true});}});
test('browser cookie, origin rejection, device tokens, revocation and expiry',async()=>{
  const {store,alice}=fixture();const server=createServer(store,{origin:'http://127.0.0.1:4387'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    assert.equal((await post('/api/login',{email:alice.email,password:'synthetic-test-password'},{Origin:'https://attacker.test'})).status,403);
    const browser=await post('/api/login',{email:alice.email,password:'synthetic-test-password'},{Origin:'http://127.0.0.1:4387'});assert.equal(browser.status,200);const cookie=browser.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.equal((await browser.json()).token,undefined);
    assert.equal((await post('/api/sync',{operations:[]},{Cookie:cookie})).status,403);
    assert.equal((await post('/api/sync',{operations:[]},{Cookie:cookie,Origin:'http://127.0.0.1:4387'})).status,200);
    assert.equal((await post('/api/logout',{expectedUserId:'other-user'},{Cookie:cookie,Origin:'http://127.0.0.1:4387'})).status,409);
    assert.equal((await post('/api/sync',{operations:[]},{Cookie:cookie,Origin:'http://127.0.0.1:4387'})).status,200);
    const device=await (await post('/api/login',{email:alice.email,password:'synthetic-test-password',device:true})).json();assert.ok(device.token);
    assert.equal((await post('/api/sync',{operations:[]},{Authorization:'Bearer '+device.token})).status,200);
    assert.equal((await post('/api/logout',{}, {Authorization:'Bearer '+device.token})).status,200);
    assert.equal((await post('/api/sync',{operations:[]},{Authorization:'Bearer '+device.token})).status,401);
    store.db.prepare('UPDATE sessions SET expires=0').run();assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
