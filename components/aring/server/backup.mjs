import { DatabaseSync,backup } from 'node:sqlite';
import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { createReadStream,createWriteStream,constants } from 'node:fs';
import { readFile,writeFile,mkdtemp,rm,stat,open,copyFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const MAGIC=Buffer.from('ARING01\n');
export async function createBackup(source,destination,keyFile){
  const key=await readFile(keyFile);if(key.length!==32)throw new Error('A 32-byte backup key is required');
  const temporary=await mkdtemp(join(tmpdir(),'aring-backup-'));let db;
  try{
    db=new DatabaseSync(source,{readOnly:true});const snapshot=join(temporary,'snapshot.sqlite');await backup(db,snapshot);db.close();db=null;
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
    const handle=await open(destination,'wx',0o600);await handle.write(Buffer.concat([MAGIC,nonce]));await handle.close();
    await pipeline(createReadStream(snapshot),cipher,createWriteStream(destination,{flags:'a',mode:0o600}));
    const final=await open(destination,'a');await final.write(cipher.getAuthTag());await final.close();
  }finally{if(db)db.close();if(!resolve(temporary).startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')))throw new Error('Unsafe temporary path');await rm(temporary,{recursive:true,force:true});}
}
export async function restoreBackup(source,destination,keyFile){
  const key=await readFile(keyFile);if(key.length!==32)throw new Error('A 32-byte backup key is required');
  const length=(await stat(source)).size;if(length<MAGIC.length+12+16)throw new Error('Invalid backup');
  const file=await open(source,'r');const header=Buffer.alloc(MAGIC.length+12),tag=Buffer.alloc(16);await file.read(header,0,header.length,0);await file.read(tag,0,16,length-16);await file.close();
  if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Unknown backup format');
  const temporary=await mkdtemp(join(tmpdir(),'aring-restore-'));let database;
  try{
    const snapshot=join(temporary,'restored.sqlite'),decipher=createDecipheriv('aes-256-gcm',key,header.subarray(MAGIC.length));decipher.setAuthTag(tag);
    await pipeline(createReadStream(source,{start:header.length,end:length-17}),decipher,createWriteStream(snapshot,{flags:'wx',mode:0o600}));
    database=new DatabaseSync(snapshot);if(database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||database.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('Backup database verification failed');
    for(const table of ['users','calendars','memberships','items','receipts','sessions'])database.prepare(`SELECT COUNT(*) FROM ${table}`).get();
    // A restored service must not trust old browser or device sessions.
    database.exec('DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE);');database.close();database=null;
    await copyFile(snapshot,destination,constants.COPYFILE_EXCL);
  }finally{if(database)database.close();if(!resolve(temporary).startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')))throw new Error('Unsafe temporary path');await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,source,destination,keyFile]=process.argv.slice(2);
  if(command==='keygen'){await writeFile(source,randomBytes(32),{flag:'wx',mode:0o600});console.log('Backup key saved. Keep a separate private copy.');}
  else if(command==='create'){await createBackup(source,destination,keyFile);console.log('Encrypted snapshot created.');}
  else if(command==='restore'){await restoreBackup(source,destination,keyFile);console.log('Backup integrity verified and restored to a new database. Sessions revoked.');}
  else throw new Error('keygen KEY_FILE | create DATABASE BACKUP KEY_FILE | restore BACKUP NEW_DATABASE KEY_FILE');
}
