# scripts/build-client.ps1
# 仅构建 Electron 前端

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "[构建] Electron 前端..." -ForegroundColor Yellow
Push-Location "$RootDir\client"
try {
    if (-not (Test-Path "node_modules")) {
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Host "[错误] npm install 失败" -ForegroundColor Red; exit 1 }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host "[错误] 构建失败" -ForegroundColor Red; exit 1 }
    Write-Host "[✓] 构建完成" -ForegroundColor Green
}
finally {
    Pop-Location
}
