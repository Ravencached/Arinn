import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/main.mjs';

test('malformed JSON values fail as client errors and arbitrary Host headers are denied',async()=>{
  const store=new Store(),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const value of [null,[],true,'text']){
      const response=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
      assert.equal(response.status,400);
    }
    const status=await new Promise((resolve,reject)=>{
      const request=http.get(origin+'/api/health',{headers:{Host:'attacker.invalid'}},response=>{response.resume();resolve(response.statusCode);});
      request.on('error',reject);
    });
    assert.equal(status,403);
    assert.equal((await fetch(origin+'/api/health')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});

test('the service rejects insecure non-loopback and non-canonical browser origins',()=>{
  const store=new Store();
  try{for(const origin of ['http://calendar.example.test','https://calendar.example.test/','https://user:password@calendar.example.test'])assert.throws(()=>createServer(store,{origin}));}
  finally{store.close();}
});

test('case and whitespace cannot bypass account throttling; forwarding headers require explicit trust',async()=>{
  const store=new Store(),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    for(let n=0;n<10;n++){
      const response=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`203.0.113.${n+1}`},body:JSON.stringify({email:n%2?' Alice@example.test ':'alice@example.test',password:'invalid password'})});
      assert.equal(response.status,401);
    }
    const response=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'198.51.100.1'},body:JSON.stringify({email:'ALICE@example.test',password:'invalid password'})});
    assert.equal(response.status,429);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
