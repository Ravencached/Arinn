// Private stdin, never a password argument or a seeded identity.
import { Store } from '../server/store.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
process.umask(0o077);
const [email,name]=process.argv.slice(2);
if(!email||!name)throw new Error('Usage: account.mjs EMAIL DISPLAY_NAME (password on stdin)');
let password='';
process.stdin.setEncoding('utf8');
for await(const part of process.stdin){password+=part;if(password.length>512)throw new Error('Password is too long');}
const path=process.env.ARING_DB||resolve('runtime/aring.sqlite');
await mkdir(dirname(path),{recursive:true,mode:0o700});
const store=new Store(path);
try{console.log(JSON.stringify(store.addUser(email,name,password)));}finally{password='';store.close();}
