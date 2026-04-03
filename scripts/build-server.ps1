# scripts/build-server.ps1
# 仅构建 Python 后端

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "[构建] Python 后端..." -ForegroundColor Yellow
Push-Location "$RootDir\server"
try {
    uv run pyinstaller build.spec --noconfirm
    if ($LASTEXITCODE -ne 0) { Write-Host "[错误] 构建失败" -ForegroundColor Red; exit 1 }
    Write-Host "[✓] 构建完成: server\dist\xgboost-server.exe" -ForegroundColor Green
}
finally {
    Pop-Location
}
