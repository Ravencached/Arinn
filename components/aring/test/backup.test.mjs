import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { Store } from '../server/store.mjs';
import { createBackup,restoreBackup } from '../server/backup.mjs';
test('encrypted restore retains authoritative records and revokes sessions; tampering fails',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aring-drill-'));let store=new Store(join(dir,'source.sqlite'));
  try{
    const user=store.addUser('recovery@example.test','Recovery','synthetic-test-password');
    const id=randomUUID();store.sync(user.id,[{opId:randomUUID(),itemId:id,baseRevision:0,action:'put',item:{id,calendarId:user.calendarId,title:'Restore me',kind:'reminder',allDay:true,start:'2026-10-14',end:'2026-10-15',timezone:'UTC',recurrence:{frequency:'weekly',interval:1},alerts:[0],exceptions:{'2026-10-14':{completed:true}}}}]);
    const session=store.login(user.email,'synthetic-test-password','device');
    const key=join(dir,'key'),archive=join(dir,'snapshot.aringbackup');await writeFile(key,randomBytes(32));
    await createBackup(join(dir,'source.sqlite'),archive,key);
    assert.equal((await readFile(archive)).includes(Buffer.from('Restore me')),false);
    await restoreBackup(archive,join(dir,'restored.sqlite'),key);store.close();store=new Store(join(dir,'restored.sqlite'));
    assert.equal(store.snapshot(user.id).items[0].title,'Restore me');assert.equal(store.snapshot(user.id).items[0].exceptions['2026-10-14'].completed,true);assert.equal(store.authenticate(session.token),null);
    await assert.rejects(restoreBackup(archive,join(dir,'restored.sqlite'),key),/exist/);
    const damaged=await readFile(archive);damaged[50]^=1;await writeFile(join(dir,'damaged'),damaged);
    await assert.rejects(restoreBackup(join(dir,'damaged'),join(dir,'rejected.sqlite'),key));
    await assert.rejects(readFile(join(dir,'rejected.sqlite')),/ENOENT/);
  }finally{store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});
