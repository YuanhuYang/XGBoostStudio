# scripts/build-all.ps1
# XGBoost Studio 一键构建脚本
# 用法：在项目根目录执行 .\scripts\build-all.ps1

param(
    [switch]$SkipServer,
    [switch]$SkipClient
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  XGBoost Studio 一键构建" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── 步骤 1：构建 Python 后端 ──────────────────────────────────────────────────
if (-not $SkipServer) {
    Write-Host "[步骤 1/3] 构建 Python 后端 (PyInstaller)..." -ForegroundColor Yellow
    
    Push-Location "$RootDir\server"
    try {
        uv run pyinstaller build.spec --noconfirm
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[错误] PyInstaller 构建失败，退出码: $LASTEXITCODE" -ForegroundColor Red
            exit 1
        }
        Write-Host "[✓] 后端构建完成: server\dist\xgboost-server.exe" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "[步骤 1/3] 跳过后端构建 (-SkipServer)" -ForegroundColor Gray
}

# ── 步骤 2：复制后端 exe 到前端资源目录 ──────────────────────────────────────
Write-Host ""
Write-Host "[步骤 2/3] 复制 xgboost-server.exe 到 client/resources/..." -ForegroundColor Yellow

$ServerExe = "$RootDir\server\dist\xgboost-server.exe"
$ResourceDir = "$RootDir\client\resources"

if (-not (Test-Path $ServerExe)) {
    Write-Host "[错误] 找不到后端可执行文件: $ServerExe" -ForegroundColor Red
    Write-Host "       请先运行构建或去掉 -SkipServer 参数" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ResourceDir)) {
    New-Item -ItemType Directory -Path $ResourceDir -Force | Out-Null
}

Copy-Item -Path $ServerExe -Destination "$ResourceDir\xgboost-server.exe" -Force
Write-Host "[✓] 复制完成: client\resources\xgboost-server.exe" -ForegroundColor Green

# ── 步骤 3：构建 Electron 前端 ────────────────────────────────────────────────
if (-not $SkipClient) {
    Write-Host ""
    Write-Host "[步骤 3/3] 构建 Electron 前端 (electron-builder)..." -ForegroundColor Yellow
    
    Push-Location "$RootDir\client"
    try {
        # 安装依赖（如果 node_modules 不存在）
        if (-not (Test-Path "node_modules")) {
            Write-Host "  正在安装 npm 依赖..." -ForegroundColor Gray
            npm install
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[错误] npm install 失败" -ForegroundColor Red
                exit 1
            }
        }
        
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[错误] 前端构建失败，退出码: $LASTEXITCODE" -ForegroundColor Red
            exit 1
        }
        Write-Host "[✓] 前端构建完成" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "[步骤 3/3] 跳过前端构建 (-SkipClient)" -ForegroundColor Gray
}

# ── 完成 ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  [✓] 构建完成！" -ForegroundColor Green
Write-Host "  产物目录（仓库根 dist\，版本号与 package.json 一致）：" -ForegroundColor Green
Write-Host "    · NSIS 安装包: dist\XGBoost Studio Setup *.exe" -ForegroundColor Green
Write-Host "    · 免安装便携: dist\XGBoost Studio *.exe（非 Setup 文件名）" -ForegroundColor Green
Write-Host "  详细说明见 docs\wiki\10-windows-distribution.md" -ForegroundColor Gray
Write-Host "================================================" -ForegroundColor Cyan
