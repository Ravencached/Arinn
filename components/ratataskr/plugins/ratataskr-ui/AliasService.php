<?php
declare(strict_types=1);

/** No mailbox passwords, API tokens or invitation plaintext are persisted here. */
final class RatataskrAccountError extends RuntimeException {}

final class RatataskrAliasService
{
    private array $config;
    private string $directory;
    private $provider;

    public function __construct(array $config, string $directory, ?callable $provider = null)
    {
        $this->config = $config;
        $this->directory = $directory;
        $this->provider = $provider;
    }

    public static function installed(): self
    {
        $path = '/etc/ratataskr-aliases/config.json';
        if (!is_readable($path)) throw new RatataskrAccountError('Account tools have not been installed yet.');
        return new self(json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR), '/var/lib/ratataskr-aliases');
    }

    private function transaction(callable $operation)
    {
        $lock = fopen($this->directory . '/state.lock', 'c');
        if (!$lock) throw new RatataskrAccountError('Account tools are busy. Please retry.');
        if (!flock($lock, LOCK_EX | LOCK_NB)) {
            fclose($lock);
            throw new RatataskrAccountError('Account tools are busy. Please retry.');
        }
        try {
            $path = $this->directory . '/state.json';
            if (is_file($path) && filesize($path) > 4 * 1024 * 1024) throw new RatataskrAccountError('Account state needs administrator review.');
            $state = is_file($path) ? json_decode(file_get_contents($path), true, 64, JSON_THROW_ON_ERROR) : ['aliases'=>[], 'invitations'=>[], 'owners'=>[], 'scripts'=>[]];
            return $operation($state, function () use (&$state, $path) {
                $temporary = tempnam($this->directory, '.state-');
                try {
                    if (file_put_contents($temporary, json_encode($state, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT)) === false) throw new RatataskrAccountError('Could not save account state.');
                    chmod($temporary, 0600);
                    if (!rename($temporary, $path)) throw new RatataskrAccountError('Could not save account state.');
                } finally { if (is_file($temporary)) unlink($temporary); }
            });
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    private function owner(string $owner, array $state): void
    {
        if (!in_array($owner, array_merge($this->config['owners'] ?? [], $state['owners']), true)) throw new RatataskrAccountError('This mailbox is not enrolled in Ratataskr account tools.');
    }

    private function writable(): void
    {
        if (!empty($this->config['readOnly'])) throw new RatataskrAccountError('Recovery mode: account changes are paused until the administrator reconciles the primary server. Mail remains available.');
    }

    private function local(string $local): string
    {
        $local = strtolower(trim($local));
        if (strlen($local) > 64 || !preg_match('/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/D', $local)) throw new RatataskrAccountError('Use letters, numbers, dots, hyphens or underscores between words.');
        return $local;
    }

    private function call(string $action, array $request): array
    {
        if (empty($this->config['enabled'])) throw new RatataskrAccountError('The provider connection is not enabled yet.');
        if ($this->provider) return ($this->provider)($action, $request);
        if (!in_array($action, ['listUser','listDomains','listRoutingRules','createRoutingRule','createUser'], true)) throw new RatataskrAccountError('Unsupported provider operation.');
        $key = trim((string)@file_get_contents('/etc/ratataskr-aliases/api-key'));
        if (!$key || strlen($key) > 4096 || preg_match('/[\x00-\x20\x7f]/', $key)) throw new RatataskrAccountError('The provider key is unavailable.');
        $curl = curl_init('https://purelymail.com/api/v0/' . $action);
        $raw = '';
        curl_setopt_array($curl, [CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>json_encode($request ?: new stdClass(), JSON_THROW_ON_ERROR), CURLOPT_HTTPHEADER=>['Content-Type: application/json', 'Purelymail-Api-Token: '.$key], CURLOPT_WRITEFUNCTION=>static function ($handle, string $chunk) use (&$raw): int {
            if (strlen($raw) + strlen($chunk) > 1024 * 1024) return 0;
            $raw .= $chunk;
            return strlen($chunk);
        }, CURLOPT_CONNECTTIMEOUT=>8, CURLOPT_TIMEOUT=>20, CURLOPT_FOLLOWLOCATION=>false, CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2]);
        $complete = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        // Never propagate raw provider errors: they may contain credentials or account details.
        if ($complete === false) throw new RatataskrAccountError('The provider request could not be confirmed. Retry or ask the administrator to reconcile it.');
        return self::providerResult($raw, $status);
    }

    public static function providerResult(string $raw, int $status): array
    {
        if ($status !== 200 || strlen($raw) > 1024 * 1024) throw new RatataskrAccountError('The provider request could not be confirmed. Retry or ask the administrator to reconcile it.');
        $data = json_decode($raw, true, 64);
        if (!is_array($data) || !array_key_exists('result', $data) || isset($data['error'])) throw new RatataskrAccountError('The provider did not confirm this operation.');
        return (array)$data['result'];
    }

    private function inventory(string $local): array
    {
        $domain = null;
        foreach ($this->call('listDomains', ['includeShared'=>false])['domains'] ?? [] as $item) if ($item['name'] === $this->config['domain']) $domain = $item;
        if (!$domain || !empty($domain['isShared']) || !array_key_exists('symbolicSubaddressing', $domain)) throw new RatataskrAccountError('The configured private domain could not be verified.');
        if ($domain['symbolicSubaddressing'] && !preg_match('/^[a-z0-9]+$/D', $local)) throw new RatataskrAccountError('Symbolic subaddressing is enabled. Use letters and numbers only (for example dev or signup); punctuation would rewrite this address.');
        $users = $this->call('listUser', [])['users'] ?? [];
        $rules = $this->call('listRoutingRules', [])['rules'] ?? [];
        if ($domain['symbolicSubaddressing']) {
            // Existing punctuated mailboxes also reserve their rewritten address.
            // Otherwise an exact alias could intercept another user's delivery.
            foreach ($users as $user) {
                $parts = explode('@', strtolower($user), 2);
                if (count($parts) === 2 && $parts[1] === $this->config['domain']) {
                    $base = preg_split('/[^a-z0-9]/', str_replace('.', '', $parts[0]), 2)[0];
                    if ($base !== '') $users[] = $base.'@'.$parts[1];
                }
            }
        }
        return [$users, $rules];
    }

    public function connectionCheck(): array
    {
        $domain = null;
        foreach ($this->call('listDomains', ['includeShared'=>false])['domains'] ?? [] as $item) if ($item['name'] === $this->config['domain']) $domain = $item;
        if (!$domain || !empty($domain['isShared'])) throw new RatataskrAccountError('The API key does not provide the configured private domain.');
        return ['domain'=>$domain['name'], 'symbolicSubaddressing'=>(bool)$domain['symbolicSubaddressing']];
    }

    private function assertAvailable(string $local, array $users, array $rules): void
    {
        $domain = $this->config['domain'];
        if (in_array($local, $this->config['reserved'] ?? [], true) || in_array($local.'@'.$domain, array_map('strtolower', $users), true)) throw new RatataskrAccountError('That address is unavailable.');
        foreach ($rules as $rule) {
            if (strtolower($rule['domainName']) !== $domain) continue;
            $match = strtolower($rule['matchUser']);
            if ($match === $local || (!empty($rule['prefix']) && str_starts_with($local, $match))) throw new RatataskrAccountError('That address is already covered by a routing rule.');
        }
    }

    public function listing(string $owner): array
    {
        return $this->transaction(function ($state) use ($owner) {
            $this->owner($owner, $state);
            $readOnly = !empty($this->config['readOnly']);
            return ['aliases'=>array_values(array_filter($state['aliases'], fn($item)=>$item['owner'] === $owner)), 'readOnly'=>$readOnly, 'enabled'=>!$readOnly && !empty($this->config['enabled']), 'folderReady'=>!$readOnly && !empty($this->config['recipientVerified']), 'admin'=>!$readOnly && in_array($owner, $this->config['administrators'] ?? [], true)];
        });
    }

    public function create(string $owner, string $local): array
    {
        $this->writable();
        $local = $this->local($local);
        return $this->transaction(function (&$state, $save) use ($owner, $local) {
            $this->owner($owner, $state);
            $address = $local.'@'.$this->config['domain'];
            $existing = $state['aliases'][$address] ?? null;
            if ($existing && $existing['owner'] !== $owner) throw new RatataskrAccountError('That address is unavailable.');
            foreach ($state['invitations'] as $invite) if ($invite['address'] === $address) throw new RatataskrAccountError('That address is reserved for an account.');
            if ($existing && $existing['receiving'] === 'active') return $existing;
            [$users, $rules] = $this->inventory($local);
            // Reconcile only an operation already recorded for this owner. Never adopt existing routes.
            if ($existing) {
                foreach ($rules as $rule) {
                    if (strtolower($rule['domainName']) === $this->config['domain'] && strtolower($rule['matchUser']) === $local && empty($rule['prefix']) && empty($rule['catchall']) && $rule['targetAddresses'] === [$owner]) {
                        $state['aliases'][$address]['receiving'] = 'active';
                        $state['aliases'][$address]['ruleId'] = $rule['id'];
                        $save(); return $state['aliases'][$address];
                    }
                }
                throw new RatataskrAccountError('The earlier routing request is still unconfirmed. Ask the administrator to reconcile it; another route was not created.');
            }
            $this->assertAvailable($local, $users, $rules);
            $state['aliases'][$address] = ['address'=>$address, 'owner'=>$owner, 'receiving'=>'pending', 'sending'=>'Provider permission and sending identity required', 'folder'=>'INBOX', 'filter'=>'pending'];
            $save(); // Reservation precedes the potentially uncertain network write.
            $this->call('createRoutingRule', ['domainName'=>$this->config['domain'], 'prefix'=>false, 'matchUser'=>$local, 'targetAddresses'=>[$owner], 'catchall'=>false]);
            foreach ($this->call('listRoutingRules', [])['rules'] ?? [] as $rule) {
                if ($rule['domainName'] === $this->config['domain'] && $rule['matchUser'] === $local && !$rule['prefix'] && !$rule['catchall'] && $rule['targetAddresses'] === [$owner]) {
                    $state['aliases'][$address]['receiving'] = 'active';
                    $state['aliases'][$address]['ruleId'] = $rule['id'];
                    $save(); return $state['aliases'][$address];
                }
            }
            throw new RatataskrAccountError('Receiving setup is pending verification. Retry this same alias to reconcile it.');
        });
    }

    public function invitation(string $owner, string $local, string $recovery): array
    {
        $this->writable();
        $local = $this->local($local);
        if (!filter_var($recovery, FILTER_VALIDATE_EMAIL)) throw new RatataskrAccountError('Enter a valid independent recovery email.');
        if (str_ends_with(strtolower($recovery), '@'.$this->config['domain'])) throw new RatataskrAccountError('Use a recovery email outside the new mailbox domain.');
        return $this->transaction(function (&$state, $save) use ($owner, $local, $recovery) {
            $this->owner($owner, $state);
            if (!in_array($owner, $this->config['administrators'] ?? [], true)) throw new RatataskrAccountError('Only the administrator can invite new accounts.');
            $address = $local.'@'.$this->config['domain'];
            if (isset($state['aliases'][$address])) throw new RatataskrAccountError('That address is unavailable.');
            foreach ($state['invitations'] as &$invite) {
                if ($invite['address'] !== $address) continue;
                if ($invite['status'] === 'revoked' || ($invite['status'] === 'invited' && $invite['expires'] < time())) { $invite['status']='revoked'; continue; }
                throw new RatataskrAccountError('That address already has an invitation.');
            }
            unset($invite);
            [$users, $rules] = $this->inventory($local); $this->assertAvailable($local, $users, $rules);
            $token = bin2hex(random_bytes(32));
            $state['invitations'][hash('sha256', $token)] = ['address'=>$address, 'recovery'=>$recovery, 'expires'=>time()+86400, 'status'=>'invited'];
            $save();
            return ['id'=>hash('sha256',$token), 'address'=>$address, 'url'=>$this->config['setupUrl'].'#'.$token, 'expires'=>'24 hours', 'status'=>'invited'];
        });
    }

    public function invitations(string $owner): array
    {
        return $this->transaction(function ($state) use ($owner) {
            $this->owner($owner, $state);
            if (!in_array($owner, $this->config['administrators'] ?? [], true)) return [];
            $items = [];
            foreach ($state['invitations'] as $id=>$invite) $items[] = ['id'=>$id]+$invite;
            return $items;
        });
    }

    public function revoke(string $owner, string $id): void
    {
        $this->writable();
        $this->transaction(function (&$state, $save) use ($owner, $id) {
            $this->owner($owner, $state);
            if (!in_array($owner, $this->config['administrators'] ?? [], true)) throw new RatataskrAccountError('Only the administrator can revoke invitations.');
            if (($state['invitations'][$id]['status'] ?? '') !== 'invited') throw new RatataskrAccountError('This invitation cannot be revoked. Provisioning and completed accounts require separate administrator review.');
            $state['invitations'][$id]['status']='revoked'; $save();
        });
    }

    public function redeem(#[SensitiveParameter] string $token, #[SensitiveParameter] string $password, string $signInEmail): string
    {
        $this->writable();
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) throw new RatataskrAccountError('This invitation is invalid.');
        if (strlen($password) < 16 || strlen($password) > 512) throw new RatataskrAccountError('Choose a password or passphrase of at least 16 characters.');
        return $this->transaction(function (&$state, $save) use ($token, $password, $signInEmail) {
            $hash = hash('sha256', $token); $invite = $state['invitations'][$hash] ?? null;
            if (!$invite || $invite['expires'] < time() || $invite['status'] !== 'invited') throw new RatataskrAccountError('This invitation expired, was used, or needs administrator review.');
            if (!hash_equals(strtolower($invite['recovery']), strtolower($signInEmail))) throw new RatataskrAccountError('Sign into site access with the email this invitation was issued to.');
            [$local, $domain] = explode('@', $invite['address'], 2);
            [$users, $rules] = $this->inventory($local); $this->assertAvailable($local, $users, $rules);
            $state['invitations'][$hash]['status'] = 'provisioning'; $save();
            // An uncertain create never retries automatically or resets an existing user's password.
            $this->call('createUser', ['userName'=>$local, 'domainName'=>$domain, 'password'=>$password, 'recoveryEmail'=>$invite['recovery'], 'enablePasswordReset'=>true, 'enableSearchIndexing'=>true, 'sendWelcomeEmail'=>false]);
            if (!in_array($invite['address'], $this->call('listUser', [])['users'] ?? [], true)) throw new RatataskrAccountError('Account creation needs administrator verification.');
            $state['owners'][] = $invite['address']; $state['owners'] = array_values(array_unique($state['owners']));
            $state['invitations'][$hash]['status'] = 'complete'; $save();
            return $invite['address'];
        });
    }

    public static function sieve(array $aliases, string $mode, string $header = ''): string
    {
        if (!in_array($mode, ['envelope','header'], true) || ($mode === 'header' && !preg_match('/^[A-Za-z0-9-]+$/D', $header))) throw new RatataskrAccountError('Original-recipient matching has not been configured.');
        $quote = fn(string $value)=>'"'.str_replace(['\\','"'], ['\\\\','\\"'], $value).'"';
        $body = '# Managed by Ratataskr. Edit mappings in Aliases & folders.' . "\nrequire [\"fileinto\"" . ($mode === 'envelope' ? ', "envelope"' : '') . "];\n";
        foreach ($aliases as $alias) {
            if ($alias['receiving'] !== 'active' || $alias['folder'] === 'INBOX') continue;
            foreach ([$alias['address'], $alias['folder']] as $value) if (preg_match('/[\x00-\x1f\x7f]/', $value)) throw new RatataskrAccountError('Invalid filter value.');
            $test = $mode === 'envelope' ? 'envelope :is "to"' : 'header :is '.$quote($header);
            $body .= 'if '.$test.' '.$quote($alias['address']).' { fileinto '.$quote($alias['folder']).'; stop; }' . "\n";
        }
        return $body;
    }

    /** The mailbox adapter supplies authenticated folder and Sieve operations. */
    public function folder(string $owner, string $address, string $folder, array $folders, callable $load, callable $put, callable $activate): void
    {
        $this->writable();
        if (strlen($folder) > 255 || !in_array($folder, $folders, true)) throw new RatataskrAccountError('Choose an existing folder in your mailbox.');
        $this->transaction(function (&$state, $save) use ($owner, $address, $folder, $load, $put, $activate) {
            $this->owner($owner, $state);
            if (($state['aliases'][$address]['owner'] ?? null) !== $owner) throw new RatataskrAccountError('Alias unavailable.');
            if (empty($this->config['recipientVerified'])) throw new RatataskrAccountError('Folder sorting awaits an original-recipient delivery test. Receiving aliases still work.');
            $snapshot = $load();
            $previous = $state['scripts'][$owner] ?? null;
            if ($previous && $previous['status'] !== 'active') throw new RatataskrAccountError('The previous filter activation needs administrator reconciliation.');
            if ($previous && empty($snapshot['Scripts'][$previous['name']]['active'])) throw new RatataskrAccountError('The managed filter was disabled or replaced elsewhere. Administrator review is needed.');
            foreach ($snapshot['Scripts'] as $script) {
                if (empty($script['active'])) continue;
                if (!$previous || $script['name'] !== $previous['name'] || !hash_equals($previous['hash'], hash('sha256', $script['body']))) throw new RatataskrAccountError('Existing filters changed or belong to another editor. Administrator review is needed; nothing was replaced.');
            }
            $candidate = $state['aliases']; $candidate[$address]['folder'] = $folder;
            $body = self::sieve(array_filter($candidate, fn($item)=>$item['owner'] === $owner), $this->config['recipientMode'] ?? '', $this->config['recipientHeader'] ?? '');
            foreach (['fileinto', ...(($this->config['recipientMode'] ?? '') === 'envelope' ? ['envelope'] : [])] as $capability) if (!in_array($capability, $snapshot['Capa'], true)) throw new RatataskrAccountError('The filter server lacks a required capability.');
            $name = 'ratataskr-' . bin2hex(random_bytes(8));
            if (!$put($name, $body)) throw new RatataskrAccountError('The filter server did not validate the new script.');
            $active = fn($data)=>array_filter($data['Scripts'], fn($script)=>!empty($script['active']));
            if ($active($load()) !== $active($snapshot)) throw new RatataskrAccountError('Filters changed during preparation. The new script was left inactive.');
            // Record intended activation so an uncertain response cannot silently overwrite foreign edits.
            $state['scripts'][$owner] = ['name'=>$name, 'hash'=>hash('sha256', $body), 'previous'=>$previous, 'status'=>'pending']; $save();
            if (!$activate($name)) throw new RatataskrAccountError('Filter activation needs verification.');
            $verified = $load()['Scripts'][$name] ?? null;
            if (!$verified || !$verified['active'] || !hash_equals(hash('sha256', $body), hash('sha256', $verified['body']))) throw new RatataskrAccountError('Filter activation needs verification.');
            $state['aliases'][$address]['folder'] = $folder; $state['aliases'][$address]['filter'] = 'active';
            $state['scripts'][$owner]['status'] = 'active'; $save();
        });
    }
}
