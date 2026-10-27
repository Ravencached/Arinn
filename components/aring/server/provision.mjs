// Read generated credentials from a private file, never command-line values.
import { readFile } from 'node:fs/promises';
import { Store } from './store.mjs';
if(!process.env.ARING_DB || !process.argv[2])throw new Error('ARING_DB and private account configuration file required');
const configuration=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!Array.isArray(configuration.accounts)||configuration.accounts.length!==2)throw new Error('Exactly two accounts required');
const store=new Store(process.env.ARING_DB);
try{
  if(store.db.prepare('SELECT COUNT(*) AS count FROM users').get().count!==0)throw new Error('Provisioning refuses to change an existing account database');
  const users=configuration.accounts.map(account=>store.addUser(account.email,account.name,account.password));
  store.family(users.map(user=>user.id));console.log('Two private accounts and the shared Family calendar provisioned. Credentials were not logged.');
}finally{store.close();}
