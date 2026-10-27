'use strict';
let selected = null;
const el = (tag, text, cls) => { const node = document.createElement(tag); node.textContent = text; if(cls)node.className=cls; return node; };
function showLink(data){$('invite-link').value=data.url;$('new-link').hidden=false;$('copy-status').textContent='';$('new-link').scrollIntoView({block:'nearest'});}
function beginAction(username,action,quota=100){
  selected={username,action};
  const texts={reissue:['Replace invitation','The old link stops working. Only an account whose password setup has not completed can be reissued.'],recovery:['Help someone back in','This replaces their password immediately, ends their sessions, and creates a one-use link valid for one hour. Keep their authenticator unless it is also lost. Files and permissions stay in place.'],quota:['Change personal storage','Recovery copies are separate from this personal quota. Existing files remain if you lower the quota below current usage.'],disable:['Disable account','Stops sign-in and ends active sessions and transfers. Files are retained.'],enable:['Enable account','Allows sign-in again. The private folder and MFA requirement remain.'],'revoke-sessions':['End active sessions','Ends this person’s sessions and transfers. They can sign in again with their existing credentials.']};
  $('action-title').textContent=texts[action][0]+' · '+username;$('action-explanation').textContent=texts[action][1];
  $('quota-field').hidden=action!=='quota';$('account-quota').value=quota;$('reset-mfa-field').hidden=action!=='recovery';$('reset-mfa').checked=false;
  $('confirm-username').value='';$('action-error').textContent='';$('account-dialog').showModal();$('confirm-username').focus();
}
const originalInvites=renderInvites;
renderInvites=function(list){originalInvites(list);const rows=$('invitation-list').querySelectorAll('.invite-row');list.forEach((item,i)=>{if(item.purpose==='invite'&&['pending','expired','revoked'].includes(item.state)){const button=el('button','Reissue','secondary');button.onclick=()=>beginAction(item.username,'reissue');rows[i].lastElementChild.append(button);}if(item.purpose==='recovery')rows[i].firstElementChild.append(el('small','Account recovery'));});};
function renderAccounts(users){
  const list=$('account-list');list.replaceChildren();
  for(const user of users){const row=el('div','','account-row'),text=el('div',''),actions=el('div','','actions');text.append(el('strong',user.username+(user.status?'':' · Disabled')),el('small',(user.used_quota_size/1024**3).toFixed(2)+' GiB used · '+(user.quota_size?user.quota_size/1024**3+' GiB limit':'Unlimited')));
    for(const action of user.username==='owner'?['recovery','revoke-sessions']:['quota',user.status?'disable':'enable','recovery','revoke-sessions']){const label={quota:'Storage',disable:'Disable',enable:'Enable',recovery:'Recovery link','revoke-sessions':'End sessions'}[action];const button=el('button',label,'secondary');button.onclick=()=>beginAction(user.username,action,user.quota_size/1024**3);actions.append(button);}row.append(text,actions);list.append(row);}
}
function renderHealth(health){
  $('health-time').textContent=health.checked?(health.stale?'Stale · ':'Checked ')+new Date(health.checked*1000).toLocaleTimeString():'Waiting for first check';
  $('health-checks').replaceChildren();for(const check of health.checks){const row=el('div','','health-row');row.append(el('strong',check.name),el('span',check.state,'health-state '+check.state),el('p',check.detail));$('health-checks').append(row);}
  $('health-events').replaceChildren(...health.events.map(e=>el('p',new Date(e.created*1000).toLocaleString()+' · '+e.message,'fine')));
}
refresh=async function(){const data=await api('/api/session');csrf=data.csrf;ownerLabel(data.owner);renderInvites(data.invitations);renderAccounts(data.users);renderHealth(data.health);$('sign-in').hidden=true;$('dashboard').hidden=false;};
$('account-action-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('action-error').textContent='';try{if($('confirm-username').value!==selected.username)throw new Error('Type the exact username to confirm.');const body={...selected,confirm_username:$('confirm-username').value,quota_gib:Number($('account-quota').value),reset_mfa:$('reset-mfa').checked};const route=selected.action==='reissue'?'/api/reissue':selected.action==='recovery'?'/api/recovery':'/api/account';const result=await api(route,body);$('account-dialog').close();if(result.url)showLink(result);$('account-status').textContent='All set. '+selected.username+' has been updated.';await refresh();}catch(error){$('action-error').textContent=error.message;}finally{button.disabled=false;}});
$('action-cancel').onclick=()=>$('account-dialog').close();
setInterval(()=>{if(!$('dashboard').hidden&&!$('account-dialog').open)refresh().catch(e=>$('account-error').textContent=e.message);},60000);
refresh().catch(()=>{});
