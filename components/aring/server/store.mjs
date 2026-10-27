import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { validateItem } from '../shared/calendar.mjs';

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`;
}
export function checkPassword(password, stored) {
  const [salt,digest] = stored.split(':');
  const actual = passwordHash(password,salt).split(':')[1];
  return timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(digest,'hex'));
}
const DUMMY_PASSWORD=passwordHash('invalid-account-password','00000000000000000000000000000000');
export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS calendars(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('private','family')),owner TEXT REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS memberships(calendar_id TEXT REFERENCES calendars(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('reader','editor')),PRIMARY KEY(calendar_id,user_id));
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,calendar_id TEXT NOT NULL REFERENCES calendars(id),payload TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(user_id TEXT NOT NULL REFERENCES users(id),op_id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,op_id));
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,device TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  user(id) { return this.db.prepare('SELECT id,email,name FROM users WHERE id=? AND active=1').get(id); }
  addUser(email,name,password) {
    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name.trim() || name.length>100 || password.length<14 || password.length>512) throw new Error('Valid email, name and a password of 14–512 characters required');
    const id = randomUUID(); const calendarId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run(id,email,name.trim(),passwordHash(password));
      this.db.prepare("INSERT INTO calendars VALUES(?,?,'private',?)").run(calendarId,`${name.trim()}’s calendar`,id);
      this.db.prepare("INSERT INTO memberships VALUES(?,?,'editor')").run(calendarId,id);
      this.db.exec('COMMIT'); return {id,email,name,calendarId};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  family(userIds) {
    if (userIds.length!==2 || new Set(userIds).size!==2 || userIds.some(id=>!this.user(id))) throw new Error('Two different active users required');
    const prior=this.db.prepare("SELECT id FROM calendars WHERE type='family'").get();
    if(prior){const members=this.db.prepare('SELECT user_id FROM memberships WHERE calendar_id=?').all(prior.id).map(m=>m.user_id);if(members.length===2&&userIds.every(id=>members.includes(id)))return prior.id;throw new Error('Family calendar already exists with different membership');}
    const id = randomUUID(); this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO calendars VALUES(?,'Family','family',NULL)").run(id);
      for (const user of userIds) this.db.prepare("INSERT INTO memberships VALUES(?,?,'editor')").run(id,user);
      this.db.exec('COMMIT'); return id;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  login(email,password,kind='browser',device='Desktop browser') {
    const record = this.db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase().trim());
    // Equal-cost work for unknown accounts limits identity probing.
    const valid = checkPassword(password,record?.password || DUMMY_PASSWORD);
    if (!record || !valid) return null;
    const token = randomBytes(32).toString('base64url'), now=Date.now();
    const expires = now + (kind==='device' ? 90 : 7)*86400000;
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(hashToken(token),record.id,kind,String(device).slice(0,100),expires,now);
    return {token,expires,...this.snapshot(record.id)};
  }
  authenticate(token,kind) {
    if (!token || token.length>150) return null;
    const session=this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(hashToken(token),Date.now());
    if (!session || (kind && session.kind!==kind) || !this.user(session.user_id)) return null;
    return {userId:session.user_id,hash:session.token_hash,kind:session.kind,expires:session.expires};
  }
  calendars(userId) {
    return this.db.prepare('SELECT c.id,c.name,c.type,m.role FROM calendars c JOIN memberships m ON m.calendar_id=c.id WHERE m.user_id=? ORDER BY c.type DESC,c.name').all(userId);
  }
  snapshot(userId) {
    return {user:this.user(userId),calendars:this.calendars(userId),items:this.db.prepare('SELECT i.payload,i.revision FROM items i JOIN memberships m ON m.calendar_id=i.calendar_id WHERE m.user_id=? AND i.deleted=0').all(userId).map(row=>({...JSON.parse(row.payload),revision:row.revision}))};
  }
  sync(userId,operations) {
    if (!Array.isArray(operations) || operations.length>100) throw new Error('At most 100 operations per sync');
    const results=[];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const calendars=this.calendars(userId);
      for (const op of operations) {
        if (!op || !/^[a-zA-Z0-9-]{8,80}$/.test(op.opId) || !/^[a-zA-Z0-9-]{8,80}$/.test(op.itemId) || !['put','delete'].includes(op.action) || !Number.isInteger(op.baseRevision) || op.baseRevision<0) throw new Error('Invalid sync operation');
        const existing = this.db.prepare('SELECT * FROM items WHERE id=?').get(op.itemId);
        const calendarId=existing?.calendar_id || op.item?.calendarId || op.calendarId;
        // Check current membership BEFORE consulting receipts or disclosing records.
        const calendar=calendars.find(c=>c.id===calendarId && c.role==='editor');
        if (!calendar || (op.item && op.item.calendarId!==calendarId)) {results.push({opId:op.opId,status:'denied',message:'Calendar unavailable'}); continue;}
        const digest=hashToken(JSON.stringify(op));
        const prior=this.db.prepare('SELECT * FROM receipts WHERE user_id=? AND op_id=?').get(userId,op.opId);
        if (prior) { results.push(prior.request_hash===digest ? JSON.parse(prior.result) : {opId:op.opId,status:'invalid',message:'Operation ID already used'}); continue; }
        let result;
        if ((existing?.revision || 0)!==op.baseRevision || (existing?.deleted && op.action==='put')) result={opId:op.opId,status:'conflict',current:existing && !existing.deleted ? {...JSON.parse(existing.payload),revision:existing.revision} : null,message:'This item changed on another device'};
        else {
          try {
            if (op.action==='put' && op.item?.id!==op.itemId) throw new Error('Item ID mismatch');
            const item=op.action==='put' ? validateItem(op.item,calendars) : existing ? JSON.parse(existing.payload) : null;
            if (!item) throw new Error('Item no longer exists');
            if(op.action==='put'){
              const usage=this.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM items WHERE calendar_id=? AND deleted=0 AND id<>?').get(calendarId,op.itemId);
              if(usage.count>=5000 || usage.bytes+Buffer.byteLength(JSON.stringify(item))>4*1024*1024)throw new Error('Calendar storage limit reached. Export and remove old items before adding more.');
            }
            const revision=(existing?.revision || 0)+1;
            this.db.prepare('INSERT INTO items VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,deleted=excluded.deleted,updated=excluded.updated').run(op.itemId,calendarId,JSON.stringify(item),revision,op.action==='delete' ? 1 : 0,Date.now());
            result={opId:op.opId,status:'ok',itemId:op.itemId,revision};
          } catch(error) {result={opId:op.opId,status:'invalid',message:error.message};}
        }
        this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(userId,op.opId,digest,JSON.stringify(result));
        results.push(result);
      }
      const snapshot=this.snapshot(userId);
      this.db.exec('COMMIT'); return {...snapshot,results};
    } catch(error) {this.db.exec('ROLLBACK'); throw error;}
  }
}
