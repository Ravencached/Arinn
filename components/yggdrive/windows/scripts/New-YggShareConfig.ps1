[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RuntimePath,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$ContentPath,
    [string]$PublicHost = 'drive.example.test',
    [int]$ClientPort = 8080,
    [int]$AdminPort = 8081,
    [switch]$TestApi
)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -Raw -LiteralPath (Join-Path $RuntimePath 'sftpgo.json') | ConvertFrom-Json
$taskConfig.common.upload_mode = 1
$taskConfig.common.symlink_mode = 0
$taskConfig.common.defender.enabled = $true
$taskConfig.common.max_per_host_connections = 30
$taskConfig.data_provider.driver = 'sqlite'
$taskConfig.data_provider.name = Join-Path $StatePath 'sftpgo.db'
$taskConfig.data_provider.track_quota = 1
$taskConfig.data_provider.users_base_dir = Join-Path $ContentPath 'Users'
$taskConfig.data_provider.create_default_admin = $false
$taskConfig.data_provider.backups_path = Join-Path $StatePath 'exports'
$taskConfig.data_provider.password_hashing.algo = 'argon2id'
$taskConfig.data_provider.password_validation.admins.min_entropy = 60
$taskConfig.data_provider.password_validation.users.min_entropy = 60
foreach ($taskProtocol in 'sftpd', 'ftpd', 'webdavd') {
    foreach ($taskBinding in $taskConfig.$taskProtocol.bindings) { $taskBinding.port = 0 }
}
$taskConfig.telemetry.bind_port = 0
$taskConfig.smtp.templates_path = Join-Path $RuntimePath 'templates'
$taskConfig.httpd.templates_path = Join-Path $RuntimePath 'templates'
$taskConfig.httpd.static_files_path = Join-Path $RuntimePath 'static'
$taskConfig.httpd.openapi_path = ''
$taskConfig.httpd.max_upload_file_size = 0
$taskConfig.httpd.token_validation = 2
$taskConfig.httpd.cookie_lifetime = 30
$taskConfig.httpd.jwt_lifetime = 20
$taskConfig.mfa.totp[0].issuer = 'YggShare'
$taskConfig.mfa.totp[0].name = 'YggShare'
$taskBase = $taskConfig.httpd.bindings[0]
$taskClient = $taskBase | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$taskAdmin = $taskBase | ConvertTo-Json -Depth 30 | ConvertFrom-Json
foreach ($taskBinding in @($taskClient, $taskAdmin)) {
    $taskBinding.address = '127.0.0.1'
    $taskBinding.enable_https = $false
    $taskBinding.render_openapi = $false
    $taskBinding.hide_login_url = 3
    $taskBinding.security.enabled = $true
    $taskBinding.security.allowed_hosts = @('127.0.0.1', 'localhost', $PublicHost)
    $taskBinding.security.content_type_nosniff = $true
    $taskBinding.security.referrer_policy = 'same-origin'
    $taskBinding.security.cache_control = 'private'
    foreach ($taskUi in 'web_client', 'web_admin') {
        $taskBinding.branding.$taskUi.name = 'YggShare'
        $taskBinding.branding.$taskUi.short_name = 'YggShare'
        $taskBinding.branding.$taskUi.logo_path = '/branding/ygg-guardian-v2.png'
        $taskBinding.branding.$taskUi.favicon_path = '/branding/ygg-mark.svg'
        $taskBinding.branding.$taskUi.disclaimer_name = 'A little help from Ygg'
        $taskBinding.branding.$taskUi.disclaimer_path = '/branding/welcome.html'
        $taskBinding.branding.$taskUi.extra_css = @('/branding/yggshare.css')
    }
}
$taskClient.port = $ClientPort
$taskClient.enable_web_admin = $false
$taskClient.enable_web_client = $true
$taskClient.enable_rest_api = [bool]$TestApi
# The browser's own file-operation routes remain available when the general API
# is off. Only the actual loopback proxy may supply visitor/HTTPS headers.
$taskClient.proxy_allowed = @('127.0.0.1/32')
$taskClient.client_ip_proxy_header = 'X-Forwarded-For'
$taskClient.client_ip_header_depth = 0
$taskClient.security.https_proxy_headers = @(@{key='X-Forwarded-Proto'; value='https'})
$taskAdmin.port = $AdminPort
$taskAdmin.enable_web_admin = $true
$taskAdmin.enable_web_client = $false
$taskAdmin.enable_rest_api = $true
$taskClient.security.allowed_hosts = @("127.0.0.1:$ClientPort", "localhost:$ClientPort", $PublicHost)
$taskAdmin.security.allowed_hosts = @("127.0.0.1:$AdminPort", "localhost:$AdminPort")
$taskConfig.httpd.bindings = @($taskClient, $taskAdmin)
if ($TestApi) {
    $taskConfig.common.defender.enabled = $false
    $taskConfig.data_provider.password_validation.admins.min_entropy = 0
    $taskConfig.data_provider.password_validation.users.min_entropy = 0
}
. (Join-Path $PSScriptRoot 'Set-YggShareBaseline.ps1')
$taskConfig = Set-YggShareBaseline -Config $taskConfig
[IO.File]::WriteAllText($OutputPath, ($taskConfig | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
Write-Output "Created loopback-only configuration: $OutputPath"
