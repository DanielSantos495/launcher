# Uso: powershell -ExecutionPolicy Bypass -File scripts\uninstall-win.ps1
$name = 'com.curyapps.launcher.spike'
foreach ($base in 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts') {
  Remove-Item -Path (Join-Path $base $name) -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path (Join-Path $env:LOCALAPPDATA 'AccountLauncherSpike') -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'Spike desinstalado de Windows'
