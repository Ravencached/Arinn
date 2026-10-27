<?php
declare(strict_types=1);
// Served only by the JWT-protected Cloudflare origin, never the Tailscale origin.
require_once '/var/lib/ratataskr-snappymail/_data_/_default_/plugins/ratataskr-ui/AliasService.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
session_name('ratataskr_setup');
session_start(['cookie_secure'=>true,'cookie_httponly'=>true,'cookie_samesite'=>'Strict','use_strict_mode'=>true]);
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    header('Content-Type: application/json');
    try {
        if (!hash_equals($_SESSION['csrf'], (string)($_POST['csrf'] ?? ''))) throw new RatataskrAccountError('This form expired. Reload and try again.');
        if (time() - ($_SESSION['last_attempt'] ?? 0) < 5) throw new RatataskrAccountError('Please wait a few seconds before trying again.');
        $_SESSION['last_attempt'] = time();
        $email = (string)($_SERVER['HTTP_CF_ACCESS_AUTHENTICATED_USER_EMAIL'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RatataskrAccountError('Verified site access is required to accept an invitation.');
        $address = RatataskrAliasService::installed()->redeem((string)($_POST['token'] ?? ''), (string)($_POST['password'] ?? ''), $email);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        echo json_encode(['ok'=>true,'address'=>$address]);
    } catch (RatataskrAccountError $error) {
        http_response_code(400); echo json_encode(['ok'=>false,'message'=>$error->getMessage()]);
    } catch (Throwable $error) {
        http_response_code(503); echo json_encode(['ok'=>false,'message'=>'Account setup needs administrator verification. Please do not submit another password until it is checked.']);
    }
    exit;
}
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join Ratataskr</title><link rel="stylesheet" href="/account-setup.css"><script src="/account-setup.js" defer></script></head>
<body><main><p class="brand">Ratataskr // Mail</p><h1>Your own mailbox.</h1><p>Accept your private invitation and choose a password. Your messages, aliases and settings will belong to your account.</p>
<form id="setup"><input type="hidden" name="csrf" value="<?= htmlspecialchars($_SESSION['csrf'], ENT_QUOTES, 'UTF-8') ?>">
<label for="password">New mailbox password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="16" maxlength="512" required aria-describedby="password-help"><p id="password-help">Use a unique password or passphrase of at least 16 characters. Save it in your password manager.</p>
<label for="confirm">Confirm password</label><input id="confirm" type="password" autocomplete="new-password" minlength="16" required>
<button type="submit">Create my mailbox</button></form><p id="status" role="status" aria-live="polite"></p><a href="/" id="open-mail" hidden>Open Ratataskr Mail</a>
<p class="footnote">Site access and mailbox sign-in are separate. Use your new family-domain mailbox address to sign into Mail.</p></main></body></html>
