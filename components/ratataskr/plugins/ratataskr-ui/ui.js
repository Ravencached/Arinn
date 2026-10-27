/* SnappyMail 2.38.2 plugin. Uses rl-view-model lifecycle; never reads mail bodies. */
(() => {
  'use strict';
  const root = document.documentElement;
  const key = 'ratataskr-appearance';
  const modes = ['system', 'light', 'dark'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem(key) || 'system'; } catch {}
  if (!modes.includes(preference)) preference = 'system';
  const controls = new Set();
  function applyMode() {
    root.dataset.ratataskrMode = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    for (const control of controls) control.value = preference;
  }
  applyMode();
  media.addEventListener('change', applyMode);
  function appearanceControl() {
    const label = document.createElement('label');
    label.className = 'rt-appearance';
    label.append('Appearance ');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Color appearance');
    for (const mode of modes) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode[0].toUpperCase() + mode.slice(1);
      select.append(option);
    }
    select.value = preference;
    controls.add(select);
    select.addEventListener('change', () => {
      preference = select.value;
      try { localStorage.setItem(key, preference); } catch {}
      applyMode();
    });
    label.append(select);
    return label;
  }
  const densityKey = 'ratataskr-density';
  const densities = ['comfortable', 'cozy', 'compact'];
  let density = 'comfortable';
  try { density = localStorage.getItem(densityKey) || density; } catch {}
  if (!densities.includes(density)) density = 'comfortable';
  root.dataset.ratataskrDensity = density;
  const densityStyle = document.createElement('style');
  densityStyle.textContent = `html:root:root:root #rl-app #V-MailMessageList .messageListItem{box-sizing:border-box;min-height:88px;padding:12px 16px;height:auto;align-items:center;}
html:root:root:root[data-ratataskr-density=cozy] #rl-app #V-MailMessageList .messageListItem{min-height:68px;padding:8px 12px;}
html:root:root:root[data-ratataskr-density=compact] #rl-app #V-MailMessageList .messageListItem{min-height:48px;padding:3px 8px;}
html:root:root:root #rl-app #V-MailMessageList .rt-row-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:normal;font-size:13px;line-height:1.45;font-weight:400;color:var(--main-color);opacity:.82;order:10;flex:0 0 100%;grid-column:1 / -1;grid-row:3;margin:4px 0 0;}
html:root:root:root[data-ratataskr-density=cozy] #rl-app #V-MailMessageList .rt-row-preview{-webkit-line-clamp:1;}
html:root:root:root[data-ratataskr-density=compact] #rl-app #V-MailMessageList .rt-row-preview{display:none;}
html:root:root:root #rl-app #V-MailMessageList .messageListItem>div+div{flex-wrap:wrap;min-width:0;}
@media(max-width:799px){html:root:root:root #rl-app #V-MailMessageList .messageListItem{min-height:104px;}html:root:root:root[data-ratataskr-density=cozy] #rl-app #V-MailMessageList .messageListItem{min-height:88px;}html:root:root:root[data-ratataskr-density=compact] #rl-app #V-MailMessageList .messageListItem{min-height:80px;}}`;
  document.head.append(densityStyle);
  function densityControl() {
    const label = document.createElement('label');
    label.className = 'rt-appearance rt-density';
    label.append('Spacing ');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Inbox spacing');
    for (const value of densities) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      select.append(option);
    }
    select.value = density;
    select.addEventListener('change', () => {
      density = select.value;
      root.dataset.ratataskrDensity = density;
      try { localStorage.setItem(densityKey, density); } catch {}
    });
    label.append(select);
    return label;
  }
  const processed = new WeakSet();
  let labelIndex = 0;
  function accessibleControls(view) {
    for (const field of view.querySelectorAll('input,select,textarea')) {
      if (field.labels?.length || field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby')) continue;
      const group = field.closest('.control-group,.form-group');
      const caption = group?.querySelector('.control-label,label');
      if (caption) {
        caption.id ||= `rt-caption-${++labelIndex}`;
        field.setAttribute('aria-labelledby', caption.id);
      } else if (field.placeholder) field.setAttribute('aria-label', field.placeholder);
    }
    for (const anchor of view.querySelectorAll('a[title]')) {
      if (!anchor.hasAttribute('aria-label') && anchor.title) anchor.setAttribute('aria-label', anchor.title);
    }
    for (const toggle of view.querySelectorAll('.toggleLeft')) {
      toggle.setAttribute('aria-label', 'Toggle folder navigation');
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      toggle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle.click();
        }
      });
    }
    for (const checkbox of view.querySelectorAll('.e-checkbox')) {
      if (processed.has(checkbox)) continue;
      processed.add(checkbox);
      const native = checkbox.querySelector('input[type=checkbox]');
      const icon = checkbox.querySelector('[role=checkbox]');
      if (!icon) continue;
      icon.removeAttribute('role');
      icon.setAttribute('aria-hidden', 'true');
      if (native) continue;
      checkbox.setAttribute('role', 'checkbox');
      const caption = checkbox.querySelector('span');
      if (caption) {
        caption.id ||= `rt-caption-${++labelIndex}`;
        checkbox.setAttribute('aria-labelledby', caption.id);
      }
      const update = () => checkbox.setAttribute('aria-checked', String(icon.textContent.includes('☑')));
      update();
      // Scoped to this existing status icon, not the application or email DOM.
      new MutationObserver(update).observe(icon, {childList:true,characterData:true,subtree:true});
    }
  }
  addEventListener('rl-view-model', event => {
    const vm = event.detail;
    const view = vm?.viewModelDom;
    if (!view) return;
    accessibleControls(view);
    const id = view.id;
    if (id === 'V-MailMessageList') {
      view.querySelector('.inputSearch')?.setAttribute('aria-label', 'Search mail');
      const renderSnippets = () => {
        for (const row of view.querySelectorAll('.messageListItem')) {
          const text = (row.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
          let snippet = row.querySelector('.rt-row-preview');
          if (!text) { snippet?.remove(); continue; }
          const content = row.querySelector('.subjectParent')?.parentElement;
          if (!content) continue;
          if (!snippet) {
            snippet = document.createElement('div');
            snippet.className = 'rt-row-preview';
            content.append(snippet);
          }
          if (snippet.textContent !== text) snippet.textContent = text;
        }
      };
      renderSnippets();
      new MutationObserver(renderSnippets).observe(view, {childList:true,subtree:true,attributes:true,attributeFilter:['title']});
      let layoutAttempts = 0;
      const applySearchLayout = () => {
        if (view.classList.contains('rt-search-first')) return;
        if (getComputedStyle(root).getPropertyValue('--rt-search-first').trim() !== '1') {
          if (++layoutAttempts < 80) setTimeout(applySearchLayout, 250);
          return;
        }
        const list = view.querySelector('.messageList');
        const search = list?.querySelector('.second-toolbar');
        const actions = view.querySelector(':scope > .btn-toolbar');
        const selectAll = search?.querySelector('.checkboxCheckAll');
        if (list && search && actions && selectAll) {
          search.after(actions);
          actions.prepend(selectAll);
          selectAll.setAttribute('role', 'checkbox');
          selectAll.setAttribute('tabindex', '0');
          selectAll.setAttribute('aria-label', 'Select all messages');
          const syncSelection = () => selectAll.setAttribute('aria-checked', vm.isIncompleteChecked() ? 'mixed' : String(!!vm.checkAll()));
          vm.checkAll.subscribe(syncSelection);
          vm.isIncompleteChecked.subscribe(syncSelection);
          syncSelection();
          selectAll.addEventListener('keydown', event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); selectAll.click(); }
          });
          view.classList.add('rt-search-first');
        }
      };
      applySearchLayout();
    }
    if (id === 'V-Settings-General') {
      const section = document.createElement('section');
      section.className = 'rt-display-settings';
      const heading = document.createElement('h3');
      heading.textContent = 'Ratataskr display';
      const note = document.createElement('p');
      note.textContent = 'Appearance and inbox spacing are remembered on this browser.';
      section.append(heading, appearanceControl(), densityControl(), note);
      view.querySelector('.form-horizontal')?.prepend(section);
    }
    if (id === 'V-Login') {
      view.querySelector('input[name=Email]')?.setAttribute('aria-label', 'Email address');
      view.querySelector('input[name=Password]')?.setAttribute('aria-label', 'Password');
      view.querySelector('.alert')?.setAttribute('role', 'alert');
      view.querySelector('.alert .close')?.setAttribute('aria-label', 'Dismiss login error');
      view.append(appearanceControl());
    }
    if (id === 'V-MailFolderList') {
      // SnappyMail may represent zero as an empty attribute, not the string "0".
      // Observe only folder status markers; update immediately when read counts change.
      const updateUnreadState = () => {
        const inbox = view.querySelector('a.selected:has(.flag-icon)');
        root.dataset.ratataskrInboxUnread = String(!!inbox && Number(inbox.getAttribute('data-unread') || 0) > 0);
      };
      updateUnreadState();
      new MutationObserver(updateUnreadState).observe(view, {
        subtree:true, attributes:true, attributeFilter:['data-unread','class'], childList:true
      });
      const brand = document.createElement('div');
      brand.className = 'rt-brand';
      const image = document.createElement('img');
      image.src = '/themes/ratataskr/images/logo-repaired.png';
      image.alt = 'Ratataskr Mail';
      brand.append(image);
      view.querySelector('.b-toolbar')?.prepend(brand);
    }
    if (id === 'V-PopupsCompose') {
      view.setAttribute('role', 'dialog');
      view.setAttribute('aria-label', 'Compose message');
      const labelEditor = () => {
        for (const editor of view.querySelectorAll('.squire-wysiwyg,.squire-plain')) {
          editor.setAttribute('aria-label', 'Message body');
          if (editor.isContentEditable) {
            editor.setAttribute('role', 'textbox');
            editor.setAttribute('aria-multiline', 'true');
          }
        }
        view.querySelector('input[type=color]')?.setAttribute('aria-label', 'Text color');
        for (const control of view.querySelectorAll('button[title],a[title]')) {
          if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', control.title);
        }
      };
      labelEditor();
      new MutationObserver(labelEditor).observe(view, {childList:true,subtree:true});
      for (const row of view.querySelectorAll('.b-header tr')) {
        const caption = row.querySelector('td');
        const field = row.querySelector('input[type=text]');
        if (field && caption) {
          caption.id ||= `rt-caption-${++labelIndex}`;
          field.setAttribute('aria-labelledby', caption.id);
        }
      }
      for (const [selector, name] of [['header > a:first-child','Send message'],['.button-save','Save draft']]) {
        view.querySelector(selector)?.setAttribute('aria-label',name);
      }
      if (vm.modalVisible?.subscribe) {
        let origin, lastOutside = document.activeElement;
        document.addEventListener('focusin', event => {
          if (!view.contains(event.target) && event.target !== document.body) lastOutside = event.target;
        });
        document.addEventListener('pointerdown', event => {
          const target = event.target.closest('a,button,input,select,textarea,[tabindex]');
          if (target && !view.contains(target)) lastOutside = target;
        }, true);
        vm.modalVisible.subscribe(visible => {
          if (visible) origin = lastOutside;
          else requestAnimationFrame(() => {
            if (origin?.isConnected && origin !== document.body) origin.focus();
          });
        });
      }
    }
  });
})();
