<?php
declare(strict_types=1);
// Separate FastCGI target for the family-user origin. In-memory only: never
// persist allow_admin_panel=false into the shared private admin configuration.
function ratataskrUserEndpoint(string $applicationRoot): void
{
    $_ENV['SNAPPYMAIL_INCLUDE_AS_API'] = '1';
    require $applicationRoot.'/index.php';
    // Initialize plugin configuration hooks before applying the origin policy.
    \RainLoop\Api::Actions();
    \RainLoop\Api::Config()->Set('security','allow_admin_panel',false);
    \RainLoop\Service::Handle();
}
if (!defined('RATATASKR_USER_ENTRY_TEST')) ratataskrUserEndpoint(__DIR__);
