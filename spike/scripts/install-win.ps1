# Uso: powershell -ExecutionPolicy Bypass -File scripts\install-win.ps1 -Browser brave -RegKeys brave
# Archivo solo ASCII: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
param(
  [Parameter(Mandatory)][ValidateSet('brave','chrome','edge')][string]$Browser,
  [Parameter(Mandatory)][ValidateSet('brave','google','edge')][string[]]$RegKeys
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# Un nombre de host por navegador (mismo esquema que macOS): -RegKeys decide en que clave se registra.
$name = "com.curyapps.launcher.spike.$Browser"
$id = (Get-Content (Join-Path $root 'extension-id.txt') -Raw).Trim()
if ($id -cnotmatch '^[a-p]{32}$') { throw 'extension-id.txt no contiene un ID valido' }
# PROCESSOR_ARCHITEW6432 da la arquitectura real si PowerShell corre como proceso de 32 bits.
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($arch) {
  'AMD64' { $hostExe = 'launcher-host.exe' }
  'ARM64' { $hostExe = 'launcher-host-arm64.exe' }
  default { throw "Arquitectura no soportada: $arch" }
}
switch ($Browser) {
  'brave'  { $candidates = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"); $userDataDir = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data" }
  'chrome' { $candidates = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"); $userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data" }
  'edge'   { $candidates = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"); $userDataDir = "$env:LOCALAPPDATA\Microsoft\Edge\User Data" }
}
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw "No encuentro el ejecutable de $Browser" }
$dest = Join-Path $env:LOCALAPPDATA "AccountLauncherSpike\$Browser"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $root "host\bin\$hostExe") (Join-Path $dest 'launcher-host.exe') -Force
$utf8 = New-Object System.Text.UTF8Encoding $false   # sin BOM: Go y Chromium leen JSON puro
$cfg = @{ browser = $Browser; exe = $exe; userDataDir = $userDataDir; launchMode = 'direct' } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $dest 'config.json'), $cfg, $utf8)
$manifest = Join-Path $dest "$name.json"
$man = @{ name = $name; description = 'Account Launcher spike host'; path = 'launcher-host.exe'; type = 'stdio'; allowed_origins = @("chrome-extension://$id/") } | ConvertTo-Json
[System.IO.File]::WriteAllText($manifest, $man, $utf8)
$bases = @{ brave = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'; google = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'; edge = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
foreach ($k in $RegKeys) {
  $key = Join-Path $bases[$k] $name
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifest
  Write-Output "Registrado en $key -> $manifest"
}
Write-Output "Host $hostExe ($arch) instalado para $Browser en $dest"
