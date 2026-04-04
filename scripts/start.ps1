# PowerShell 启动脚本 - Windows
# 
# 用法:
#   .\scripts\start.ps1 -Server       # 启动后端服务
#   .\scripts\start.ps1 -Client       # 启动前端开发服务
#   .\scripts\start.ps1 -All          # 启动后端和前端
#   .\scripts\start.ps1 -Help         # 显示帮助

param(
    [switch]$Server,
    [switch]$Client,
    [switch]$All,
    [switch]$Help
)

$RootDir = (Get-Item (Split-Path -Parent $MyInvocation.MyCommand.Path)).Parent.FullName
$ServerDir = Join-Path $RootDir "server"
$ClientDir = Join-Path $RootDir "client"

function Print-Usage {
    Write-Host @"
XGBoost Studio 启动脚本 - Windows PowerShell

用法:
    .\scripts\start.ps1 -Server       # 启动后端服务 (127.0.0.1:18899)
    .\scripts\start.ps1 -Client       # 启动前端开发服务 (http://localhost:5173)
    .\scripts\start.ps1 -All          # 同时启动后端和前端
    .\scripts\start.ps1 -Help         # 显示此帮助

环境要求:
    - Python 3.8+ 和 uv (后端)
    - Node.js 16+ 和 npm (前端)

示例:
    # PowerShell 1：启动后端
    .\scripts\start.ps1 -Server

    # PowerShell 2：启动前端
    .\scripts\start.ps1 -Client

    # 或者同时启动
    .\scripts\start.ps1 -All
"@
}

function Start-Server {
    Write-Host "================================" -ForegroundColor Green
    Write-Host "启动后端服务 (FastAPI)" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host "地址: http://127.0.0.1:18899" -ForegroundColor Yellow
    Write-Host "按 Ctrl+C 停止" -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $ServerDir
    & uv run python main.py
}

function Start-Client {
    Write-Host "================================" -ForegroundColor Green
    Write-Host "启动前端开发服务 (Vite)" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host "地址: http://localhost:5173" -ForegroundColor Yellow
    Write-Host "按 Ctrl+C 停止" -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $ClientDir
    & npm run dev
}

function Start-All {
    Write-Host "================================" -ForegroundColor Green
    Write-Host "启动完整开发环境" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "后端服务: http://127.0.0.1:18899"
    Write-Host "前端服务: http://localhost:5173"
    Write-Host ""
    Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow
    Write-Host ""
    
    # 启动后端（后台）
    Set-Location $ServerDir
    $ServerProcess = Start-Process -FilePath "uv" -ArgumentList "run", "python", "main.py" -NoNewWindow -PassThru
    
    # 等待后端启动
    Start-Sleep -Seconds 2
    
    # 启动前端（前台）
    Set-Location $ClientDir
    try {
        & npm run dev
    }
    finally {
        # 清理：当前端退出时，杀死后端
        if ($null -ne $ServerProcess -and -not $ServerProcess.HasExited) {
            $ServerProcess | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    }
}

# 主逻辑
if ($Help) {
    Print-Usage
}
elseif ($Server) {
    Start-Server
}
elseif ($Client) {
    Start-Client
}
elseif ($All) {
    Start-All
}
else {
    Print-Usage
}
