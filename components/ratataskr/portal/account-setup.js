(() => {
  'use strict';
  let token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname); // Keep invitations out of history/referrers.
  const form = document.querySelector('#setup');
  const status = document.querySelector('#status');
  const button = form.querySelector('button');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    form.hidden = true; status.textContent = 'Now that you are signed into site access, reopen the private invitation link your administrator gave you.'; return;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (form.password.value !== document.querySelector('#confirm').value) { status.textContent = 'The passwords do not match.'; return; }
    button.disabled = true; status.textContent = 'Creating your mailbox…';
    const body = new FormData(form); body.set('token', token);
    try {
      const response = await fetch(location.pathname, {method:'POST', body, credentials:'same-origin', cache:'no-store'});
      const result = await response.json();
      if (!result.ok) throw new Error(result.message);
      token = ''; form.reset(); form.hidden = true;
      status.textContent = `Your mailbox is ready: ${result.address}. Sign into Mail using this address and the password you just saved.`;
      document.querySelector('#open-mail').hidden = false;
    } catch (error) { status.textContent = error.message || 'Setup could not be confirmed. Ask your administrator before retrying.'; }
    finally { form.password.value = ''; document.querySelector('#confirm').value = ''; button.disabled = false; }
  });
})();
