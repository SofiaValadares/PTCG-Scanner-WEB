$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$py = Join-Path (Split-Path (Get-Location)) "TCGTradeSegmentacao\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    $py = Join-Path (Split-Path (Get-Location)) "API-PTCG Scanner\.venv\Scripts\python.exe"
}
if (-not (Test-Path $py)) {
    Write-Host "Não achei o Python do projeto."
    exit 1
}

Write-Host "Site com o modelo: http://127.0.0.1:5500"
Write-Host "A primeira abertura espera o detector, o OCR e o catálogo."
& $py serve.py
