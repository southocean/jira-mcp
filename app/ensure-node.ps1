# Ensure Node.js is available for the installer.
#
# If `node` is already on PATH, does nothing. Otherwise downloads the latest LTS
# Node.js (from nodejs.org) into a per-user folder — NO admin required — and adds
# it to the user PATH. Called by "Install Jira MCP.cmd" when Node is missing.

$ErrorActionPreference = "Stop"

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "Node.js already installed."
  exit 0
}

# Detect architecture.
$arch = "x64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { $arch = "arm64" }
elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = "x86" }

Write-Host "Node.js was not found. Fetching the latest LTS release..."
$index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
$ver = ($index | Where-Object { $_.lts } | Select-Object -First 1).version   # e.g. v22.20.0
if (-not $ver) { throw "Could not determine the latest Node LTS version." }

$name = "node-$ver-win-$arch"
$url  = "https://nodejs.org/dist/$ver/$name.zip"
Write-Host "Installing Node.js $ver ($arch) — no admin required..."

$tmp = Join-Path $env:TEMP ("node-dl-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $zip = Join-Path $tmp "$name.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force

  $dest = Join-Path $env:LOCALAPPDATA "Programs\nodejs"
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Move-Item (Join-Path $tmp $name) $dest

  # Persist to the user PATH (safe registry append; no setx truncation risk).
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$dest*") {
    $new = if ([string]::IsNullOrEmpty($userPath)) { $dest } else { $userPath.TrimEnd(';') + ';' + $dest }
    [Environment]::SetEnvironmentVariable("Path", $new, "User")
  }
  Write-Host "Installed Node.js to $dest"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
