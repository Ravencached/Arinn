/* SnappyMail 2.38.2: native minimize retains the existing draft and attachments.
 * Compatibility points: ComposePopupView.inEdit, skipCommand and showModal.
 * Keep native modal focus/keyboard behavior; never clone or replace the editor. */
(() => {
  'use strict';
  const built = new WeakSet();
  addEventListener('rl-view-model', ({detail: vm}) => {
    const view = vm?.viewModelDom;
    if (view?.id !== 'V-PopupsCompose' || built.has(view)) return;
    const inEdit = vm.constructor.inEdit;
    if (!inEdit?.subscribe || !vm.modalVisible?.subscribe || !vm.constructor.showModal) return;
    built.add(view);
    view.classList.add('rt-compose-docked');
    // Android keyboards can shrink the visual viewport without changing 100dvh.
    const viewport = window.visualViewport;
    if (viewport) {
      const updateHeight = () => view.style.setProperty('--rt-compose-visible-height', `${Math.floor(viewport.height)}px`);
      viewport.addEventListener('resize', updateHeight);
      updateHeight();
    }
    const header = view.querySelector('header');
    const bar = document.createElement('div');
    bar.className = 'rt-compose-titlebar';
    const title = document.createElement('span');
    title.textContent = 'New message';
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'rt-compose-expand';
    expand.textContent = '⤢';
    expand.setAttribute('aria-label', 'Expand compose window');
    expand.setAttribute('aria-pressed', 'false');
    expand.addEventListener('click', () => {
      const expanded = view.classList.toggle('rt-compose-expanded');
      expand.setAttribute('aria-pressed', String(expanded));
      expand.setAttribute('aria-label', expanded ? 'Dock compose window' : 'Expand compose window');
      expand.textContent = expanded ? '⤡' : '⤢';
    });
    bar.append(title, expand);
    header?.before(bar);
    const minimize = view.querySelector('.minimize-custom');
    if (minimize) {
      minimize.setAttribute('aria-label', 'Minimize message to bottom tab');
      minimize.setAttribute('role', 'button');
      minimize.tabIndex = 0;
      minimize.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); minimize.click();
        }
      });
    }
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'rt-compose-restore';
    restore.hidden = true;
    restore.setAttribute('aria-label', 'Restore minimized message');
    restore.textContent = '✎  Continue message';
    restore.addEventListener('click', () => vm.constructor.showModal());
    document.body.append(restore);
    const sync = () => {
      restore.hidden = vm.modalVisible() || !inEdit();
    };
    inEdit.subscribe(sync);
    vm.modalVisible.subscribe(sync);
    addEventListener('sm-show-screen', ({detail}) => {
      if (detail !== 'mailbox' && detail !== 'settings') restore.hidden = true;
    });
    sync();
  });
})();
