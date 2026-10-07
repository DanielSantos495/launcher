# Uso: powershell -ExecutionPolicy Bypass -File scripts\uninstall-win.ps1
# Borra los nombres por navegador y el nombre unico antiguo en las tres claves.
$names = 'com.curyapps.launcher.spike.brave', 'com.curyapps.launcher.spike.chrome', 'com.curyapps.launcher.spike.edge', 'com.curyapps.launcher.spike'
foreach ($base in 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts') {
  foreach ($name in $names) {
    Remove-Item -Path (Join-Path $base $name) -Force -ErrorAction SilentlyContinue
  }
}
Remove-Item -Path (Join-Path $env:LOCALAPPDATA 'AccountLauncherSpike') -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'Spike desinstalado de Windows'
