import { Capacitor, registerPlugin } from '@capacitor/core';
import { mergeSync } from '../shared/calendar.mjs';
export const native=Capacitor.isNativePlatform();
export const bridge=registerPlugin('AringNative');
export const emptyState=()=>({user:null,calendars:[],items:[],pending:[],inFlight:[],conflicts:[],visibility:{},lastSync:null,status:'Ready'});
let database;
const channel=!native&&typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel('aring-state-v1'):null;
export function onStateChange(callback){if(channel)channel.onmessage=()=>void callback();}
async function db(){
  if(database)return database;
  database=await new Promise((resolve,reject)=>{const r=indexedDB.open('aring-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return database;
}
async function transaction(change){
  if(native)return bridge.changeState({change}).then(r=>r.state);
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction('state','readwrite');const store=tx.objectStore('state');const r=store.get('active');let result;
    r.onsuccess=()=>{try{result=update(r.result || emptyState(),change);store.put(result,'active');}catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>{channel?.postMessage({type:'state-changed'});resolve(result);};tx.onerror=()=>reject(tx.error);
  });
}
export function queueChange(state,mutation){
  const id=mutation.itemId;const old=state.items.find(i=>i.id===id);const prior=state.pending.find(p=>p.itemId===id);
  const calendarId=mutation.item?.calendarId||old?.calendarId||mutation.calendarId;
  if(!state.calendars?.some(c=>c.id===calendarId&&c.role==='editor'))throw new Error('Calendar unavailable for this account');
  const pending=state.pending.filter(p=>p.itemId!==id);
  if(mutation.action==='delete'&&prior?.baseRevision===0&&!(state.inFlight||[]).some(p=>p.itemId===id)){return {...state,items:state.items.filter(i=>i.id!==id),pending};}
  const baseRevision=prior?.baseRevision??mutation.baseRevision??old?.revision??0;
  pending.push({...mutation,opId:crypto.randomUUID(),baseRevision,calendarId:mutation.item?.calendarId||old?.calendarId||mutation.calendarId});
  const items=state.items.filter(i=>i.id!==id);if(mutation.action==='put')items.push({...mutation.item,revision:prior?.baseRevision??old?.revision??0,pending:true});
  return {...state,items,pending,status:'Changes saved on this device'};
}
export function update(state,change){
  if(change.type==='replace')return change.state;
  if(change.type==='clear')return state.user?.id===change.userId?emptyState():state;
  if(['mutation','visibility','resolve'].includes(change.type)&&state.user?.id!==change.userId)throw new Error('Account changed in another window. Reopen Áring before editing.');
  if(change.type==='mutation')return queueChange(state,change.mutation);
  if(change.type==='import'){
    if(state.user?.id!==change.userId)throw new Error('Account changed during import');
    return change.items.reduce((s,item)=>queueChange(s,{action:'put',itemId:item.id,item,baseRevision:0}),state);
  }
  if(change.type==='visibility')return {...state,visibility:{...state.visibility,[change.id]:change.visible}};
  if(change.type==='status')return change.userId&&state.user?.id!==change.userId?state:{...state,status:change.status};
  if(change.type==='sending')return state.user?.id===change.userId?{...state,inFlight:change.sent}:state;
  if(change.type==='reauthenticate')return state.user?.id===change.response.user?.id?{...mergeSync(state,{...change.response,results:[]},[]),inFlight:state.inFlight||[]}:state;
  if(change.type==='sync'){
    if(state.user?.id!==change.userId||change.response.user?.id!==change.userId)return state;
    const sent=change.sent;
    // Edits made while a previous version was in flight inherit its acknowledged
    // revision, so the next upload does not conflict with this device's own write.
    state={...state,pending:state.pending.map(p=>{
      const old=sent.find(s=>s.itemId===p.itemId);const ok=change.response.results.find(r=>r.opId===old?.opId&&r.status==='ok');
      return ok&&p.opId!==old.opId&&p.baseRevision===old.baseRevision ? {...p,baseRevision:ok.revision} : p;
    })};
    return {...mergeSync(state,change.response,sent),inFlight:[]};
  }
  if(change.type==='resolve'){
    const conflict=state.conflicts.find(c=>c.opId===change.opId);
    if(!conflict)return state;
    state={...state,conflicts:state.conflicts.filter(c=>c.opId!==change.opId)};
    if(change.keep && conflict.local){
      const local=conflict.local;
      if(!conflict.current && local.action==='put'){
        const item={...local.item,id:crypto.randomUUID()};return queueChange(state,{action:'put',itemId:item.id,item});
      }
      return queueChange(state,{...local,baseRevision:undefined,itemId:local.itemId});
    }
    return state;
  }
  return state;
}
export const storage={
  async read(){if(native)return (await bridge.readState()).state;const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('state').objectStore('state').get('active');r.onsuccess=()=>resolve(r.result||emptyState());r.onerror=()=>reject(r.error);});},
  replace:state=>transaction({type:'replace',state}),
  clear:userId=>transaction({type:'clear',userId}),
  mutate:(mutation,userId)=>transaction({type:'mutation',mutation,userId}),
  importItems:(items,userId)=>transaction({type:'import',items,userId}),
  visibility:(id,visible,userId)=>transaction({type:'visibility',id,visible,userId}),
  status:(status,userId)=>transaction({type:'status',status,userId}),
  markSending:(sent,userId)=>transaction({type:'sending',sent,userId}),
  reauthenticate:response=>transaction({type:'reauthenticate',response}),
  applySync:(response,sent,userId)=>transaction({type:'sync',response,sent,userId}),
  resolve:(opId,keep,userId)=>transaction({type:'resolve',opId,keep,userId})
};
