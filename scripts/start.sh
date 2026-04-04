#!/bin/bash

# 跨平台启动脚本 - macOS / Linux
# 
# 用法:
#   bash scripts/start.sh --server      # 启动后端服务
#   bash scripts/start.sh --client      # 启动前端开发服务
#   bash scripts/start.sh --all         # 启动后端和前端
#   bash scripts/start.sh --help        # 显示帮助

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_usage() {
    cat << EOF
XGBoost Studio 启动脚本 - macOS / Linux

用法:
    bash scripts/start.sh --server      # 启动后端服务 (127.0.0.1:18899)
    bash scripts/start.sh --client      # 启动前端开发服务 (http://localhost:5173)
    bash scripts/start.sh --all         # 同时启动后端和前端
    bash scripts/start.sh --help        # 显示此帮助

环境要求:
    - Python 3.8+ 和 uv (后端)
    - Node.js 16+ 和 npm (前端)

示例:
    # 终端 1：启动后端
    bash scripts/start.sh --server

    # 终端 2：启动前端
    bash scripts/start.sh --client

    # 或者一次启动全部（需要两个终端）
    bash scripts/start.sh --all
EOF
}

start_server() {
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}启动后端服务 (FastAPI)${NC}"
    echo -e "${GREEN}================================${NC}"
    echo -e "${YELLOW}地址: http://127.0.0.1:18899${NC}"
    echo "按 Ctrl+C 停止"
    echo ""
    
    cd "$SERVER_DIR"
    uv run python main.py
}

start_client() {
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}启动前端开发服务 (Vite)${NC}"
    echo -e "${GREEN}================================${NC}"
    echo -e "${YELLOW}地址: http://localhost:5173${NC}"
    echo "按 Ctrl+C 停止"
    echo ""

    cd "$CLIENT_DIR"
    if [[ "$(uname -s)" == "Linux" ]]; then
        echo -e "${YELLOW}Linux 检测到：使用 Web 模式（浏览器访问，无需 Electron）${NC}"
        npm run dev:web
    else
        npm run dev
    fi
}

start_all() {
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}启动完整开发环境${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo "后端服务: http://127.0.0.1:18899"
    echo "前端服务: http://localhost:5173"
    echo ""
    echo "按 Ctrl+C 停止所有服务"
    echo ""
    
    # 启动后端（后台）
    cd "$SERVER_DIR"
    uv run python main.py &
    SERVER_PID=$!

    # 等待后端启动
    sleep 2

    # 清理：当前端退出时，杀死后端
    trap "kill $SERVER_PID 2>/dev/null; exit" EXIT INT TERM

    # 启动前端（前台，Linux 使用 Web 模式）
    cd "$CLIENT_DIR"
    if [[ "$(uname -s)" == "Linux" ]]; then
        echo -e "${YELLOW}Linux 检测到：前端使用 Web 模式${NC}"
        npm run dev:web
    else
        npm run dev
    fi
}

# 主逻辑
case "${1:-}" in
    --server)
        start_server
        ;;
    --client)
        start_client
        ;;
    --all)
        start_all
        ;;
    --help)
        print_usage
        ;;
    "")
        print_usage
        exit 0
        ;;
    *)
        echo -e "${RED}未知选项: $1${NC}"
        echo ""
        print_usage
        exit 1
        ;;
esac
