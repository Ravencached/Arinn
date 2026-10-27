(() => {
  'use strict';
  if (!window.rl || !window.ko) return;
  class RatataskrAliases {
    constructor() {
      for (const name of ['local', 'recovery', 'inviteLocal', 'message', 'inviteUrl']) this[name] = ko.observable('');
      for (const name of ['busy', 'enabled', 'admin', 'folderReady']) this[name] = ko.observable(false);
      this.aliases = ko.observableArray([]);
      this.folders = ko.observableArray([]);
      this.invitations = ko.observableArray([]);
    }
    request(parameters, success) {
      if (this.busy()) return;
      this.busy(true); this.message('');
      rl.pluginRemoteRequest((error, response) => {
        this.busy(false);
        const result = response?.Result;
        if (error || !result?.ok) { this.message(result?.message || 'Could not complete this request. Please retry.'); return; }
        if (success) success(result);
        else {
          this.aliases(result.aliases.map(alias => ({...alias, chosenFolder: ko.observable(alias.folder)})));
          this.folders(result.folders || []);
          this.invitations(result.invitations || []);
          this.enabled(result.enabled); this.admin(result.admin); this.folderReady(result.folderReady);
          this.message(result.readOnly ? 'Recovery mode: mail is available; account changes are paused until the administrator reconciles the primary server.' : (parameters.Operation === 'list' ? '' : 'Saved.'));
        }
      }, 'RatataskrAliases', parameters, 120000);
    }
    onShow() { this.refresh(); }
    refresh() { this.request({Operation:'list'}); }
    create() { this.request({Operation:'create', Local:this.local()}); }
    saveFolder(alias) { this.request({Operation:'folder', Address:alias.address, Folder:alias.chosenFolder()}); }
    revoke(invitation) { this.request({Operation:'revoke', Invitation:invitation.id}); }
    invite() {
      this.inviteUrl('');
      this.request({Operation:'invite', Local:this.inviteLocal(), Recovery:this.recovery()}, result => {
        this.inviteUrl(result.invitation.url);
        this.invitations.push(result.invitation);
        this.message('Invitation created. Share it privately; it expires in 24 hours. Add the recipient to Cloudflare Access before they open it.');
      });
    }
  }
  rl.addSettingsViewModel(RatataskrAliases, 'RatataskrAliases', 'Aliases & folders', 'ratataskr-aliases');
})();
