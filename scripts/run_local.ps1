$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "Site: http://127.0.0.1:5500"
Write-Host "A API precisa estar em http://127.0.0.1:8000 (pasta API-PTCG Scanner)."
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    $py = "C:\Users\Pichau\Documents\Repositorios\TCGTradeSegmentacao\.venv\Scripts\python.exe"
} else {
    $py = "python"
}
& $py -m http.server 5500
