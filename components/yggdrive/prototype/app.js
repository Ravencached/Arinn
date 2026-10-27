/* Interaction prototype only: no server, authentication, file reads, persistence, or network requests. */
'use strict';
const icons = {
 home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
 folder:'<path d="M3 7V5h6l2 3h10v12H3Z"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5v2"/>',
 leaf:'<path d="M20 3C8 3 2 7 4 15s15 6 16-12Z"/><path d="M3 22 15 10"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 1-1 1-1 3m0 3h.01"/>',
 file:'<path d="M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8m-8 4h6"/>',
 photo:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m3 18 6-5 4 3 4-5 4 7"/>',
 dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
 grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 logout:'<path d="M9 3H3v18h6m-1-9h13m-5-5 5 5-5 5"/>',
 download:'<path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {screen:'home',section:'home',folder:null,query:'',view:'list'};
let nextId = 10;
const folders = [
 {name:'Documents',note:'The everyday essentials',icon:'folder'},
 {name:'Photos & memories',note:'Little moments, kept close',icon:'photo'},
 {name:'Projects',note:'Room for your next idea',icon:'folder'}
];
const files = [
 {id:1,name:'A weekend away.pdf',folder:'Documents',size:2.4*1024*1024,date:'Today',kind:'file',note:'A sample itinerary for a quiet weekend.'},
 {id:2,name:'Sunday in the garden.jpg',folder:'Photos & memories',size:4.8*1024*1024,date:'Yesterday',kind:'photo',note:'A sample photo entry. No photograph is stored in this preview.'},
 {id:3,name:'Home notes.txt',folder:'Documents',size:3200,date:'Oct 23',kind:'text',note:'A place for the small things you want to remember.\n\nThis is sample text created for the design preview.'},
 {id:4,name:'A few good ideas.pdf',folder:'Projects',size:1.2*1024*1024,date:'Oct 21',kind:'file',note:'A sample project notebook.'}
];
const app = document.getElementById('app');
const modal = document.getElementById('modal');
const screenSelect = document.getElementById('screen-select');
const input = document.getElementById('file-input');
let toastTimer;
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
function setScreen(screen){state.screen=screen;screenSelect.value=screen;render();window.scrollTo(0,0);}
function brand(){return '<a class="brand-link" href="#" data-action="home"><img src="ygg-mark.svg" alt=""><div><span class="brand">YggShare</span><div class="brand-caption">A little closer to home</div></div></a>';}
function bytes(n){return n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:n<1024**3?`${(n/1024**2).toFixed(1)} MB`:`${(n/1024**3).toFixed(1)} GB`;}
function fileType(f){return `<span class="file-type ${esc(f.kind)}">${icon(f.kind==='photo'?'photo':'file')}</span>`;}
function showFiles(){
 const found=files.filter(f=>(!state.folder||f.folder===state.folder)&&(!state.query||f.name.toLowerCase().includes(state.query.toLowerCase())));
 if(!found.length)return `<div class="empty">${icon(state.query?'search':'folder')}<h3>${state.query?'No files found':'A fresh little beginning'}</h3><p>${state.query?'Try a different name. Search only looks in your current private space.':'Add your first file whenever you’re ready. This folder belongs to you.'}</p>${state.query?'':'<button class="btn" data-action="upload">Try adding a file</button>'}</div>`;
 if(state.view==='grid')return `<div class="file-grid">${found.map(f=>`<button class="file-tile" data-file="${f.id}">${fileType(f)}<strong>${esc(f.name)}</strong><small>${bytes(f.size)} · ${esc(f.date)}</small></button>`).join('')}</div>`;
 return `<table class="file-list"><thead><tr><th scope="col">Name</th><th scope="col" class="date-col">Added</th><th scope="col">Size</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${found.map(f=>`<tr><td><button class="file-button" data-file="${f.id}">${fileType(f)}<span><strong>${esc(f.name)}</strong><small>${esc(f.folder)}</small></span></button></td><td class="date-col">${esc(f.date)}</td><td>${bytes(f.size)}</td><td><button class="icon-button" data-file="${f.id}" aria-label="Details for ${esc(f.name)}">${icon('dots')}</button></td></tr>`).join('')}</tbody></table>`;
}
function renderHome(){
 const isShared=state.section==='shared',isFiles=state.section==='files',isHome=state.section==='home';
 const title=isShared?'Shared with me':state.folder|| (isFiles?'My files':'Welcome home.');
 app.innerHTML=`<div class="shell"><aside class="sidebar">${brand()}<nav aria-label="Your drive"><p class="nav-label">Your place</p>${[['home','home','Home'],['files','folder','My files'],['shared','people','Shared with me']].map(([key,i,label])=>`<button class="nav-button ${state.section===key?'active':''}" data-section="${key}" ${state.section===key?'aria-current="page"':''}>${icon(i)}${label}</button>`).join('')}</nav><div class="side-bottom"><button class="nav-button" data-action="help">${icon('help')}A little help from Ygg</button><div class="storage"><span class="eyebrow">Your space · Sample</span><div class="meter" role="img" aria-label="Sample storage: 24 of 100 gigabytes used"><span></span></div><p><strong>24 GB</strong> of 100 GB used</p></div><button class="account" data-action="account"><span class="avatar">A</span><span>Alex<small>Personal account · Demo</small></span>${icon('dots')}</button></div></aside><div class="workspace"><header class="topbar"><span class="address">${icon('lock')}drive.example.test</span><label class="search">${icon('search')}<span class="sr-only">Search your files</span><input id="search" placeholder="Find something in your space…" value="${esc(state.query)}" ${isShared?'disabled':''}></label><button class="icon-button" data-action="help" aria-label="Help">${icon('help')}</button></header><main class="content"><div class="heading-row"><div><h1>${esc(title)}</h1><p>${isShared?'Only folders someone has explicitly shared with you.':state.folder?'A little space for the things that matter.':isFiles?'Everything here belongs to your personal space.':'Your things, in their own familiar place.'}</p></div>${isShared?'':`<div class="actions"><button class="btn" data-action="new-folder">${icon('plus')}New folder</button><button class="btn primary" data-action="upload">${icon('upload')}Add files</button></div>`}</div>${state.folder?`<div class="breadcrumbs"><button data-section="files">My files</button>${icon('chevron')}<span>${esc(state.folder)}</span></div>`:''}${isHome?`<section class="welcome" aria-labelledby="greeting"><div><div class="eyebrow">A familiar face, a quiet helping hand</div><h2 id="greeting">“Good to have you here.”</h2><p>I’m Ygg. I’ll help you find your way around.<br>Your files stay in your own space, until you choose to share.</p><button class="text-link" data-action="privacy">How your space works ${icon('arrow')}</button></div><img src="assets/ygg-guardian-v2.png" alt="Ygg, a sturdy oak guardian with kind eyes and an outstretched welcoming hand"></section>`:''}${isShared?`<div class="empty">${icon('people')}<h3>Nothing shared with you yet.</h3><p>Your private space is ready to use. When a folder is explicitly shared with your account, it will appear here.</p><button class="btn" data-section="files">Go to my files ${icon('arrow')}</button></div>`:`${!state.folder&&!state.query?`<section aria-label="Your folders"><div class="section-title"><h2>Your folders</h2><span class="privacy-badge">${icon('lock')}Personal space</span></div><div class="folders">${folders.map(f=>`<button class="folder-card" data-folder="${esc(f.name)}"><span class="folder-graphic">${icon(f.icon)}</span>${icon('chevron')}<h3>${esc(f.name)}</h3><p>${esc(f.note)}</p></button>`).join('')}</div></section>`:''}<div class="lower-grid"><section class="file-section" aria-label="Files"><div class="section-title"><h2>${state.query?'Search results':state.folder?'In this folder':isHome?'Recently added':'All files'}</h2><div class="file-controls"><div class="view-toggle" role="group" aria-label="File view"><button class="${state.view==='list'?'active':''}" data-view="list" aria-label="List view" aria-pressed="${state.view==='list'}">${icon('list')}</button><button class="${state.view==='grid'?'active':''}" data-view="grid" aria-label="Grid view" aria-pressed="${state.view==='grid'}">${icon('grid')}</button></div></div></div><div id="file-results" aria-live="polite">${showFiles()}</div></section><aside class="note-card"><div class="leaf">${icon('leaf')}</div><h3>A place that’s<br>yours to grow.</h3><p>Keep a document, save a memory, make room for an idea. Start small. You can organize as you go.</p><button class="text-link" data-action="help">Find your feet ${icon('arrow')}</button><div class="caption" style="margin-top:22px">${icon('shield')}Other family accounts can’t browse your personal folder.</div></aside></div>`}<footer class="footer"><span>${icon('leaf')}Rooted at home. Made for you.</span><span>YggShare · example</span></footer></main></div></div>`;
}
function renderAuth(){
 const verify=state.screen==='verify';
 app.innerHTML=`<main class="auth-wrap"><section class="auth-story">${brand()}<img class="auth-illustration" src="assets/ygg-guardian-v2.png" alt="Ygg, your welcoming tree guardian"><h1>A familiar place.<br>A little peace of mind.</h1><p>“Come on in. There’s a space here just for you.”</p><div class="eyebrow">Your friend at the door · Ygg</div></section><section class="auth-main"><div class="auth-form"><div class="eyebrow" style="margin-bottom:18px">drive.example.test</div><h2>${verify?'One small check.':'Welcome to YggShare.'}</h2><p>${verify?'Use the code from your authenticator app to finish signing in.':'Sign in to your own space for files, memories, and the everyday things.'}</p>${verify?'<label for="demo-code">Authenticator code</label><input id="demo-code" class="code-input" value="123456" readonly aria-describedby="demo-notice"><button class="btn primary" data-action="enter-demo">Preview your drive '+icon('arrow')+'</button><button class="text-link" data-action="recovery">Use a recovery code</button>':'<label for="demo-user">Username</label><input id="demo-user" value="alex" readonly aria-describedby="demo-notice"><label for="demo-password">Password</label><input id="demo-password" type="password" value="sample-only" readonly aria-describedby="demo-notice"><button class="btn primary" data-action="verify">Preview sign-in '+icon('arrow')+'</button><button class="text-link" data-action="recovery">Need help signing in?</button>'}<p class="auth-info">${icon('shield')}Your account opens only your personal folder and any folders explicitly shared with you.</p><p class="demo-note" id="demo-notice">Design preview. These values are examples. No credentials are accepted, checked, stored, or sent.</p></div></section></main>`;
}
function renderUnavailable(){app.innerHTML=`<main class="unavailable"><div><img src="assets/ygg-guardian-v2.png" alt="Ygg"><div class="eyebrow">Connection message · Preview</div><h1>I can’t reach home right now.</h1><p>YggShare is temporarily unavailable. Check your internet connection and try again in a moment. If it continues, contact the person who manages YggShare.</p><div class="actions"><button class="btn primary" data-action="enter-demo">Return to preview</button><button class="btn" data-action="help">Get help</button></div><p class="demo-note" style="margin-top:22px">Example message for a service interruption. A complete YGG outage may show your browser’s connection error instead.</p></div></main>`;}
function render(){if(state.screen==='home')renderHome();else if(state.screen==='unavailable')renderUnavailable();else renderAuth();}
function openModal(title,body,actions=''){document.getElementById('modal-content').innerHTML=`<div class="modal-body"><div class="modal-top"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>${body}${actions}</div>`;modal.showModal();}
function showHelp(){openModal('A little help from Ygg',`<img src="assets/ygg-guardian-v2.png" alt="Ygg"><p>“Let’s find your feet. What would you like to do?”</p><div class="info-line"><b>Add something</b><span>My files → Add files</span></div><div class="info-line"><b>Keep things tidy</b><span>My files → New folder</span></div><div class="info-line"><b>See who has access</b><span>Open a file’s details</span></div><p class="fine">Ygg is a guide. This design does not read your documents, send them to AI, or create a chatbot with access to your files.</p>`);}
function showFile(id){const f=files.find(x=>x.id===Number(id));if(!f)return;openModal('A closer look',`<p style="overflow-wrap:anywhere"><b>${esc(f.name)}</b></p><div class="info-line"><b>Where it lives</b><span>My files / ${esc(f.folder)}</span></div><div class="info-line"><b>Who has access</b><span>Your personal account</span></div><div class="info-line"><b>Size</b><span>${bytes(f.size)}</span></div><p class="fine">${esc(f.note||'Added to the sample list during this preview. File contents were not read or uploaded.').replace(/\n/g,'<br>')}</p><p>Sharing outside your account is off by default. Contact your YggShare administrator to request a shared folder.</p>`,`<div class="actions"><button class="btn" data-action="download-demo" data-download="${f.id}">${icon('download')}Download sample note</button></div>`);}
document.addEventListener('click',event=>{
 const el=event.target.closest('button,a');if(!el)return;
 if(el.hasAttribute('data-section')){state.section=el.dataset.section;state.folder=null;state.query='';setScreen('home');return;}
 if(el.hasAttribute('data-folder')){state.section='files';state.folder=el.dataset.folder;state.query='';render();return;}
 if(el.hasAttribute('data-file')){showFile(el.dataset.file);return;}
 if(el.hasAttribute('data-view')){state.view=el.dataset.view;render();return;}
 const action=el.dataset.action;if(!action)return;event.preventDefault();
 if(action==='home'||action==='enter-demo'){state.section='home';state.folder=null;state.query='';setScreen('home');}
 if(action==='verify')setScreen('verify');
 if(action==='close')modal.close();
 if(action==='upload'){input.value='';input.click();}
 if(action==='new-folder')openModal('A new little space',`<label for="folder-name">Folder name</label><input id="folder-name" maxlength="80" placeholder="What would you like to call it?" autocomplete="off"><p class="field-error" id="folder-error" role="alert"></p><p>Created in My files. Visible only to your account.</p>`,`<div class="actions"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="create-folder">Create demo folder</button></div>`);
 if(action==='create-folder'){
  const name=document.getElementById('folder-name').value.trim();
  if(!name||/[\\/:*?"<>|\u0000-\u001f]/.test(name)||/^\.+$/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||folders.some(f=>f.name.toLowerCase()===name.toLowerCase())){document.getElementById('folder-error').textContent='Choose a new name without reserved characters or Windows device names.';return;}
  folders.push({name,note:'Ready for something good',icon:'folder'});state.folder=null;state.section='files';state.query='';modal.close();render();toast('Demo folder created. Changes last until you refresh.');
 }
 if(action==='help')showHelp();
 if(action==='privacy')openModal('Your very own space',`<p>Your login opens your personal folder. Other family accounts can’t browse it. Shared folders appear only when access is explicitly granted.</p><p>The people who administer YGG and its backups can access stored files for maintenance and recovery. This is not end-to-end encrypted storage.</p><p class="fine">“I’ll keep the boundaries clear, and help you know who can see what.” — Ygg</p>`);
 if(action==='account')openModal('Your account',`<p>Alex · Sample family member</p><div class="info-line"><b>Sign-in</b><span>Password + authenticator</span></div><div class="info-line"><b>Access</b><span>Own personal folder</span></div><p class="fine">In production, account settings also provide password changes, two-factor setup, and recovery codes.</p>`,`<div class="actions"><button class="btn" data-action="signout">${icon('logout')}Preview sign out</button></div>`);
 if(action==='signout'){modal.close();setScreen('login');}
 if(action==='recovery')openModal('Let’s get you back in',`<p>In production, use one of your saved recovery codes if you’ve lost access to your authenticator. If you’re locked out completely, contact your YggShare administrator.</p><p>Access is restored only after your identity has been verified. Resetting an account must never open someone else’s folder.</p><p class="fine">This preview does not accept passwords or recovery codes.</p>`);
 if(action==='download-demo'){
  const f=files.find(x=>x.id===Number(el.dataset.download));
  const blob=new Blob([`YggShare design preview\n\nSample entry: ${f.name}\n\n${f.note||'This is a demonstration entry.'}\n\nThis text file is a sample note, not the original file. No connection to YGG has been made.\n`],{type:'text/plain'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='yggshare-sample-note.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Downloaded a generated sample note.');
 }
});
document.addEventListener('input',event=>{if(event.target.id==='search'){state.query=event.target.value;document.getElementById('file-results').innerHTML=showFiles();document.querySelector('.file-section h2').textContent=state.query?'Search results':state.folder?'In this folder':state.section==='home'?'Recently added':'All files';}});
input.addEventListener('change',()=>{const picked=Array.from(input.files);if(!picked.length)return;for(const f of picked){files.unshift({id:nextId++,name:f.name,folder:state.folder||'Documents',size:f.size,date:'Just now',kind:f.type.startsWith('image/')?'photo':'file'});}state.section='files';state.query='';render();input.value='';toast(`${picked.length} demo ${picked.length===1?'entry':'entries'} added. Names and sizes only; nothing uploaded.`);});
screenSelect.addEventListener('change',()=>setScreen(screenSelect.value));
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)modal.close();}});
render();
