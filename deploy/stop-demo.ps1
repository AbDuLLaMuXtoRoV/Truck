# Stops everything start-demo.ps1 started.
$pidsFile = Join-Path $PSScriptRoot "pids.json"
if (-not (Test-Path $pidsFile)) { Write-Host "Nothing to stop (no deploy\pids.json)."; exit 0 }
$pids = Get-Content $pidsFile | ConvertFrom-Json
foreach ($name in $pids.PSObject.Properties.Name) {
    $id = $pids.$name
    & taskkill /PID $id /T /F 2>$null | Out-Null
    Write-Host "stopped $name (pid $id)"
}
Remove-Item $pidsFile
Remove-Item (Join-Path $PSScriptRoot "PUBLIC_URL.txt") -ErrorAction SilentlyContinue
