$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$outputDir = Join-Path $root "release\app"
$unpackedDir = Join-Path $outputDir "win-unpacked"
$zipPath = Join-Path $outputDir "TokenRing-$version-win-x64.zip"
$installPath = Join-Path $outputDir "INSTALL.txt"

if (!(Test-Path (Join-Path $unpackedDir "TokenRing.exe"))) {
  throw "TokenRing.exe was not found in $unpackedDir"
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $unpackedDir "*") -DestinationPath $zipPath -Force

@"
TokenRing $version for Windows x64

Install:

1. Extract TokenRing-$version-win-x64.zip to a permanent folder.
2. Run TokenRing.exe.
3. Keep the app running while using the browser extension.

This is an unpacked Electron app. TokenRing.exe depends on the adjacent files in the same folder, so keep the extracted folder intact.
"@ | Set-Content -LiteralPath $installPath -Encoding UTF8

Write-Host "Created $zipPath"
Write-Host "Created $installPath"
