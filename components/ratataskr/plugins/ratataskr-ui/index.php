<?php
class RatataskrUiPlugin extends \RainLoop\Plugins\AbstractPlugin
{
    const NAME = 'Ratataskr UI';
    const AUTHOR = 'Ratataskr';
    const VERSION = '0.5.3';
    const REQUIRED = '2.38.2';
    const CATEGORY = 'User Interface';
    const DESCRIPTION = 'Ratataskr appearance controls, shell branding and accessibility refinements.';
    public function Init() : void
    {
        $this->addJs('ui.js');
        $this->addJs('compose-dock.js');
        $this->addJs('aliases.js');
        $this->addTemplate('RatataskrAliases.html');
        $this->addJsonHook('RatataskrAliases', 'Aliases');
        $this->addHook('json.after-FolderCreate', 'RecoverCreatedFolder');
        $this->addCss('ui.css');
    }

    // SnappyMail 2.38.2 can return null after a successful CREATE because its
    // follow-up LIST uses the new name as the reference rather than the pattern.
    // Recover only that result, using the already authenticated mailbox.
    public function RecoverCreatedFolder(array &$response) : void
    {
        if (!array_key_exists('Result', $response) || $response['Result'] !== null) return;
        $actions = $this->Manager()->Actions();
        $name = trim((string)$actions->GetActionParam('folder', ''));
        $parent = trim((string)$actions->GetActionParam('parent', ''));
        if ($name === '') return;
        try {
            $delimiter = $parent === '' ? '' : $actions->ImapClient()->FolderHierarchyDelimiter($parent);
            if ($parent !== '' && $delimiter === null) return;
            $fullName = $parent . ($parent === '' ? '' : $delimiter) . $name;
            foreach ($actions->MailClient()->Folders('', '*', false) as $folder) {
                if ($folder->FullName === $fullName && $folder->Selectable()) {
                    $response['Result'] = $actions->DefaultResponse($folder)['Result'];
                    return;
                }
            }
        } catch (\Throwable $error) {
            // Preserve the original response if read-only recovery fails.
        }
    }

    public function Aliases()
    {
        require_once __DIR__.'/AliasService.php';
        $actions = $this->Manager()->Actions();
        $account = $actions->GetAccount(true);
        $owner = strtolower($account->Email());
        try {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new RatataskrAccountError('Use an authenticated POST request.');
            $service = RatataskrAliasService::installed();
            $operation = (string)$this->jsonParam('Operation', 'list');
            // Destination, rule IDs and owner are never accepted from the browser.
            if ($operation === 'create') $service->create($owner, (string)$this->jsonParam('Local', ''));
            elseif ($operation === 'invite') {
                $invite = $service->invitation($owner, (string)$this->jsonParam('Local', ''), (string)$this->jsonParam('Recovery', ''));
                // SnappyMail can log JSON responses. Redact the bearer token even in debug mode.
                $actions->Logger()->SetShowSecrets(false);
                $actions->Logger()->AddSecret(substr($invite['url'], strpos($invite['url'], '#')+1));
                return $this->jsonResponse(__FUNCTION__, ['ok'=>true, 'invitation'=>$invite]);
            } elseif ($operation === 'revoke') $service->revoke($owner, (string)$this->jsonParam('Invitation', ''));
            elseif (!in_array($operation, ['list','folder'], true)) throw new RatataskrAccountError('Unsupported operation.');
            $result = $service->listing($owner);
            $folders = [];
            if ($operation === 'folder' || $result['folderReady']) {
                $this->requireVerifiedTls($account->Domain()->ImapSettings());
                if (!$account->ImapConnectAndLogin($this->Manager(), $actions->ImapClient(), $actions->Config())) throw new RatataskrAccountError('Could not connect to your mailbox.');
                foreach ($actions->MailClient()->Folders('', '*', false) as $folder) if ($folder->Selectable()) $folders[] = $folder->FullName;
            }
            if ($operation === 'folder') {
                $sieveSettings = $account->Domain()->SieveSettings();
                if (!$sieveSettings->enabled) throw new RatataskrAccountError('The administrator needs to enable ManageSieve for this domain.');
                $this->requireVerifiedTls($sieveSettings);
                $storage = new \RainLoop\Providers\Filters\SieveStorage($this->Manager(), $actions->Config());
                $service->folder($owner, (string)$this->jsonParam('Address', ''), (string)$this->jsonParam('Folder', ''), $folders,
                    fn()=>$storage->Load($account), fn($name,$body)=>$storage->Save($account,$name,$body), fn($name)=>$storage->Activate($account,$name));
                $result = $service->listing($owner);
            }
            $result['folders'] = $folders;
            $result['invitations'] = $service->invitations($owner);
            return $this->jsonResponse(__FUNCTION__, ['ok'=>true]+$result);
        } catch (\RatataskrAccountError $error) {
            return $this->jsonResponse(__FUNCTION__, ['ok'=>false, 'message'=>$error->getMessage()]);
        } catch (\Throwable $error) {
            return $this->jsonResponse(__FUNCTION__, ['ok'=>false, 'message'=>'Account tools could not complete this operation. No credentials were exposed. Please ask the administrator to check the installation.']);
        }
    }

    private function requireVerifiedTls($settings): void
    {
        if (!in_array($settings->type, [1,2], true) || !$settings->ssl->verify_peer || !$settings->ssl->verify_peer_name || $settings->ssl->allow_self_signed) {
            throw new RatataskrAccountError('Enable explicit TLS and certificate verification in the mailbox domain settings before using folder tools.');
        }
    }
}
