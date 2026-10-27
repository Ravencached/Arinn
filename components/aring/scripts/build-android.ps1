param([switch]$DebugBuild)
$ErrorActionPreference='Stop'
if (!$env:JAVA_HOME -or !$env:ANDROID_HOME) { throw 'Set JAVA_HOME (JDK 21) and ANDROID_HOME (SDK 36) first.' }
$taskGradle=Get-Command gradle -ErrorAction Stop
if (!$DebugBuild -and (!$env:ARING_KEYSTORE -or !$env:ARING_SIGNING_PASSWORD)) {
    throw 'Release builds require your own ARING_KEYSTORE and ARING_SIGNING_PASSWORD; no signing key is distributed.'
}
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or Capacitor sync failed' }
    Push-Location android
    try {
        if ($DebugBuild) { & $taskGradle.Source --no-daemon testDebugUnitTest lintDebug assembleDebug }
        else { & $taskGradle.Source --no-daemon testReleaseUnitTest lintRelease assembleRelease }
        if ($LASTEXITCODE -ne 0) { throw 'Android tests, lint or build failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
