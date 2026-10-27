# Shared, testable configuration transformation. Does not start services or
# write files; callers explicitly choose a staging or production output.
function Set-YggShareBaseline {
    param([Parameter(Mandatory)]$Config)
    $Config.common.rate_limiters = @([pscustomobject]@{
        average=20;period=1000;burst=60;type=2;protocols=@('HTTP');
        generate_defender_events=$false;entries_soft_limit=1000;entries_hard_limit=2000
    })
    $Config.common.defender.entries_soft_limit=1000
    $Config.common.defender.entries_hard_limit=2000
    # A conservative CSP that preserves upstream inline scripts, PDF/image
    # previews and same-origin frames while blocking off-site framing/forms.
    foreach($taskBinding in $Config.httpd.bindings) {
        $taskBinding.security.content_security_policy="base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    }
    foreach($taskBinding in $Config.httpd.bindings | Where-Object enable_web_client) {
        $taskBinding.security.sts_seconds=15552000
        $taskBinding.security.sts_include_subdomains=$false
        $taskBinding.security.sts_preload=$false
    }
    return $Config
}
