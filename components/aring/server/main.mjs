import http from 'node:http';
import { isIP } from 'node:net';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createServer(store,options={}) {
  const origin=options.origin || 'http://127.0.0.1:4387';
  const configured = new URL(origin);
  if (configured.origin !== origin || configured.username || configured.password || (!origin.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) throw new Error('An exact HTTPS origin (or loopback HTTP origin) is required');
  const secure=origin.startsWith('https:'); const failures=new Map();
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const server = http.createServer({maxHeaderSize:16384,headersTimeout:10000,requestTimeout:15000,connectionsCheckingInterval:1000},async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const localHost = `${req.socket.localAddress}:${req.socket.localPort}`;
      if (![configured.host,localHost].includes(req.headers.host) || !req.url.startsWith('/') || req.url.startsWith('//')) return send(res,403,{error:'Host rejected'});
      const url=new URL(req.url,origin);
      if (url.pathname==='/api/health' && req.method==='GET') return send(res,200,{service:'aring',version:'0.1.0',status:'ready'});
      if (url.pathname.startsWith('/api/')) {
        // Native clients send no Origin and use bearer credentials. Browser writes
        // require the exact configured origin; no wildcard CORS is provided.
        const bearer=req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
        if (req.method!=='GET' && req.headers.origin!==origin && (req.headers.origin || (!bearer && url.pathname!=='/api/login'))) return send(res,403,{error:'Origin rejected'});
        if (req.headers.origin && req.headers.origin!==origin) return send(res,403,{error:'Origin rejected'});
        let body={};
        if (req.method==='POST') {
          if (!String(req.headers['content-type']).startsWith('application/json')) return send(res,415,{error:'JSON required'});
          const chunks=[];let bytes=0;
          for await (const chunk of req) {bytes+=chunk.length;if(bytes>2*1024*1024)return send(res,413,{error:'Request too large'});chunks.push(chunk);}
          body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || typeof body!=='object' || Array.isArray(body)) return send(res,400,{error:'JSON object required'});
        }
        if (url.pathname==='/api/login' && req.method==='POST') {
          let address=req.socket.remoteAddress;
          // Opt-in trust for a local proxy that OVERWRITES forwarded headers.
          const forwarded=req.headers['x-forwarded-for'];
          if(options.trustProxy && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address) && typeof forwarded==='string' && isIP(forwarded)) address=forwarded;
          if (typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length>512) return send(res,400,{error:'Invalid sign-in request'});
          body.email=body.email.trim().toLowerCase();
          const key=`${address}:${body.email}`;
          const now=Date.now();
          for(const [k,v] of failures) if(v.until<=now) failures.delete(k);
          if(failures.size>=4096 && (!failures.has(address)||!failures.has(key))) return send(res,429,{error:'Too many attempts. Try again later.'});
          const rate=failures.get(key)||{count:0,until:Date.now()+900000};
          const global=failures.get(address)||{count:0,until:Date.now()+900000};
          if ((rate.until>Date.now()&&rate.count>=10)||(global.until>Date.now()&&global.count>=50)) return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
          if (typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length>512) return send(res,400,{error:'Invalid sign-in request'});
          if (body.device===true && req.headers.origin) return send(res,403,{error:'Device enrollment requires the native app'});
          const login=store.login(body.email,body.password,body.device===true?'device':'browser',body.deviceName);
          if(!login){for(const k of [key,address]){const r=failures.get(k);failures.set(k,{count:r&&r.until>Date.now()?r.count+1:1,until:r&&r.until>Date.now()?r.until:Date.now()+900000});}if(failures.size>10000)for(const [k,v]of failures)if(v.until<Date.now())failures.delete(k);return send(res,401,{error:'Email or password was not recognized'});}
          failures.delete(key);
          const {token,...publicData}=login;
          if(body.device===true)return send(res,200,{...publicData,token});
          res.setHeader('Set-Cookie',`${secure?'__Host-':''}aring_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`);
          return send(res,200,publicData);
        }
        const cookies=req.headers.cookie||'';
        const cookie=cookies.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${secure?'__Host-':''}aring_session=`))?.split('=')[1];
        const session=store.authenticate(bearer||cookie,bearer?'device':'browser');
        if(!session)return send(res,401,{error:'Sign in to resume synchronization'});
        if(req.method==='POST'&&body.expectedUserId&&body.expectedUserId!==session.userId)return send(res,409,{error:'Account changed in another window. Sign in again to resume.'});
        if(url.pathname==='/api/session'&&req.method==='GET')return send(res,200,{...store.snapshot(session.userId),expires:session.expires});
        if(url.pathname==='/api/sync'&&req.method==='POST')return send(res,200,store.sync(session.userId,body.operations));
        if(url.pathname==='/api/devices'&&req.method==='GET')return send(res,200,{devices:store.db.prepare('SELECT token_hash AS id,kind,device,expires,created FROM sessions WHERE user_id=? AND expires>?').all(session.userId,Date.now()).map(d=>({...d,current:d.id===session.hash}))});
        if(url.pathname==='/api/revoke'&&req.method==='POST'){store.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash=?').run(session.userId,String(body.id));return send(res,200,{ok:true});}
        if(url.pathname==='/api/logout'&&req.method==='POST'){store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.hash);res.setHeader('Set-Cookie',`${secure?'__Host-':''}aring_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);return send(res,200,{ok:true});}
        return send(res,404,{error:'Not found'});
      }
      if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed'});
      const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(!/^[a-zA-Z0-9._-]+$/.test(filename))return send(res,404,{error:'Not found'});
      const path=resolve(root,'dist',filename);const data=await readFile(path);
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':filename==='sw.js'?'no-cache':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    } catch(error) {
      if(error.code==='ENOENT')return send(res,404,{error:'Not found'});
      if(error instanceof SyntaxError || error.message?.startsWith('Invalid sync') || error.message?.startsWith('At most'))return send(res,400,{error:'Invalid request'});
      console.error('Request failed:',error.name);send(res,500,{error:'Service unavailable. Your local changes are retained.'});
    }
  });
  server.maxConnections=64;
  server.keepAliveTimeout=5000;
  return server;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.umask(0o077);
  const db=process.env.ARING_DB || resolve(root,'runtime/aring.sqlite'); await mkdir(dirname(db),{recursive:true,mode:0o700});
  const origin=process.env.ARING_ORIGIN || 'http://127.0.0.1:4387';
  if(!origin.startsWith('https://')&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))throw new Error('HTTPS required outside loopback');
  const store=new Store(db);const server=createServer(store,{origin,trustProxy:process.env.ARING_TRUST_PROXY==='true'});
  const bind=process.env.ARING_BIND || '127.0.0.1';
  if(!['127.0.0.1','0.0.0.0'].includes(bind)) throw new Error('Unsupported bind address');
  server.listen(Number(process.env.ARING_PORT || 4387),bind,()=>console.log(`Áring listening at ${bind}:${process.env.ARING_PORT||4387}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
