# Starts the Smart Truck demo on this PC:
#   API + Telegram bot (polling) + AI  -> http://127.0.0.1:8010
#   Dashboard (proxies /api to the API) -> http://localhost:3000
#   Public HTTPS URL via a Cloudflare quick tunnel, if cloudflared is installed
#     (install once:  winget install --id Cloudflare.cloudflared)
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy\start-demo.ps1 [-NoTunnel]
# Stop:   powershell -ExecutionPolicy Bypass -File deploy\stop-demo.ps1
param([switch]$NoTunnel)
$ErrorActionPreference = "Stop"

$deploy = $PSScriptRoot
$root = Split-Path -Parent $deploy
$logs = Join-Path $deploy "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$pidsFile = Join-Path $deploy "pids.json"
$urlFile = Join-Path $deploy "PUBLIC_URL.txt"
$apiPort = 8010
$webPort = 3000

if (Test-Path $pidsFile) {
    Write-Host "Demo seems to be running already (deploy\pids.json exists). Run stop-demo.ps1 first." -ForegroundColor Yellow
    exit 1
}
foreach ($port in @($apiPort, $webPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $port is already in use. Free it or stop the other app first." -ForegroundColor Red
        exit 1
    }
}

$pids = [ordered]@{}
$publicUrl = $null

# 1. Public tunnel first, so the API knows the dashboard URL for Telegram DM links.
if (-not $NoTunnel) {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    $cfPath = if ($cf) { $cf.Source } elseif (Test-Path "$deploy\bin\cloudflared.exe") { "$deploy\bin\cloudflared.exe" } else { $null }
    if ($cfPath) {
        Remove-Item "$logs\tunnel.log" -ErrorAction SilentlyContinue
        $tunnel = Start-Process -FilePath $cfPath -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:$webPort", "--logfile", "$logs\tunnel.log" `
            -WindowStyle Hidden -PassThru
        $pids.tunnel = $tunnel.Id
        for ($i = 0; $i -lt 60 -and -not $publicUrl; $i++) {
            Start-Sleep -Milliseconds 500
            if (Test-Path "$logs\tunnel.log") {
                $m = Select-String -Path "$logs\tunnel.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
                if ($m) { $publicUrl = $m.Matches[0].Value }
            }
        }
        if (-not $publicUrl) { Write-Host "Tunnel started but no URL yet - check deploy\logs\tunnel.log" -ForegroundColor Yellow }
    } else {
        Write-Host "cloudflared not found - running locally only. Install: winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
    }
}

# 2. API: Telegram polling + AI + background jobs (settings come from backend\.env).
$env:DASHBOARD_URL = if ($publicUrl) { $publicUrl } else { "http://localhost:$webPort" }
$api = Start-Process -FilePath "$root\backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$apiPort", "--timeout-keep-alive", "65" `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api.err.log"
$pids.api = $api.Id

# 3. Dashboard (production build; /api is proxied to the API, so one URL serves everything).
$web = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx next start -p $webPort" `
    -WorkingDirectory "$root\frontend" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web.err.log"
$pids.web = $web.Id

$pids | ConvertTo-Json | Set-Content $pidsFile

# Wait for health.
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 500
    try { $ok = (Invoke-RestMethod "http://127.0.0.1:$webPort/api/health" -TimeoutSec 2).status -eq "ok" } catch { }
}

Write-Host ""
Write-Host "Smart Truck demo is running" -ForegroundColor Green
Write-Host "  Local:   http://localhost:$webPort"
if ($publicUrl) {
    Set-Content $urlFile $publicUrl
    Write-Host "  Public:  $publicUrl" -ForegroundColor Cyan
}
Write-Host "  Health:  $(if ($ok) { 'ok' } else { 'not ready yet - see deploy\logs' })"
Write-Host "  Logins:  deploy\DEMO_LOGINS.txt"
Write-Host "  Logs:    deploy\logs\  (api.err.log has the bot + AI log)"
Write-Host "Keep this PC on and awake; the quick-tunnel URL changes every time you restart."
