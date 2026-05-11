$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $root "extension\manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$outputDir = Join-Path $root "release\extension"
$zipPath = Join-Path $outputDir "TokenRing-Collector-$version.zip"
$installPath = Join-Path $outputDir "INSTALL.txt"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $root "extension\*") -DestinationPath $zipPath -Force

@"
TokenRing Collector $version

Install on Chrome or Edge:

1. Extract TokenRing-Collector-$version.zip to a permanent folder.
2. Open chrome://extensions or edge://extensions.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the extracted extension folder.
6. Keep TokenRing desktop app running.
7. Open these pages and click the extension popup's Refresh open tabs now:
   - https://claude.ai/settings/usage
   - https://chatgpt.com/codex/cloud/settings/analytics#usage
   - https://z.ai/manage-apikey/subscription

Chrome local extension packages are intentionally installed as unpacked folders. Do not delete the extracted folder after loading it.
"@ | Set-Content -LiteralPath $installPath -Encoding UTF8

Write-Host "Created $zipPath"
Write-Host "Created $installPath"
