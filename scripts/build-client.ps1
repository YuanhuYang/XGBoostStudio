# scripts/build-client.ps1
# 仅构建 Electron 前端

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "[构建] Electron 前端..." -ForegroundColor Yellow

$serverExe = Join-Path $RootDir "server\dist\xgboost-server.exe"
if (-not (Test-Path $serverExe)) {
    Write-Host "[错误] 未找到 $serverExe — 请先运行 scripts\build-server.ps1" -ForegroundColor Red
    exit 1
}
$resDir = Join-Path $RootDir "client\resources"
New-Item -ItemType Directory -Force -Path $resDir | Out-Null
Copy-Item $serverExe (Join-Path $resDir "xgboost-server.exe") -Force
Write-Host "[✓] 已同步后端可执行文件到 client\resources\" -ForegroundColor Green

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
