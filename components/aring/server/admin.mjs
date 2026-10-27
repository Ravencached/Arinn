import { readFile, mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { Store,passwordHash } from './store.mjs';
process.umask(0o077);
const db=process.env.ARING_DB || resolve('runtime/aring.sqlite');await mkdir(dirname(db),{recursive:true,mode:0o700});
const store=new Store(db);
try {
  const [command,...args]=process.argv.slice(2);
  if(command==='create'){
    const [email,name,passwordFile]=args;
    if(!passwordFile)throw new Error('create EMAIL NAME PASSWORD_FILE (password file outside source control)');
    const password=(await readFile(passwordFile,'utf8')).trimEnd();
    const user=store.addUser(email,name,password);console.log(JSON.stringify(user,null,2));
  } else if(command==='family')console.log('Family calendar:',store.family(args));
  else if(command==='list')console.log(JSON.stringify(store.db.prepare('SELECT id,email,name,active FROM users').all(),null,2));
  else if(command==='disable'){store.db.prepare('UPDATE users SET active=0 WHERE id=?').run(args[0]);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(args[0]);console.log('Account disabled; sessions revoked.');}
  else if(command==='password'){
    const password=(await readFile(args[1],'utf8')).trimEnd();if(password.length<14 || password.length>512)throw new Error('Password must have 14–512 characters');
    store.db.exec('BEGIN IMMEDIATE');store.db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(password),args[0]);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(args[0]);store.db.exec('COMMIT');console.log('Password changed; all sessions revoked.');
  } else if(command==='unshare'){store.db.prepare('DELETE FROM memberships WHERE calendar_id=? AND user_id=?').run(args[0],args[1]);console.log('Membership removed.');}
  else throw new Error('Commands: create, family, list, disable, password, unshare');
} finally {store.close();}
