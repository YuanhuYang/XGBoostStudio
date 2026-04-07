#!/usr/bin/env bash
# XGBoost Studio 一键构建（macOS / Linux，与 CI release 任务对齐）
# 用法：在仓库根目录执行 ./scripts/build-all.sh
# 可选：--skip-server 仅打客户端；--skip-client 仅打后端（需已有 dist 内二进制）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_SERVER=false
SKIP_CLIENT=false

for arg in "$@"; do
  case "$arg" in
    --skip-server) SKIP_SERVER=true ;;
    --skip-client) SKIP_CLIENT=true ;;
  esac
done

OS_UNAME="$(uname -s)"
if [[ "$OS_UNAME" == MINGW* ]] || [[ "$OS_UNAME" == MSYS* ]] || [[ "$OS_UNAME" == CYGWIN* ]]; then
  SERVER_BIN="$ROOT/server/dist/xgboost-server.exe"
  RES_BIN="$ROOT/client/resources/xgboost-server.exe"
else
  SERVER_BIN="$ROOT/server/dist/xgboost-server"
  RES_BIN="$ROOT/client/resources/xgboost-server"
fi

echo "================================================"
echo "  XGBoost Studio 一键构建 (Unix)"
echo "================================================"

if [[ "$SKIP_SERVER" != true ]]; then
  echo "[1/3] PyInstaller 后端..."
  cd "$ROOT/server"
  uv sync --all-groups --frozen
  uv run pyinstaller build.spec --noconfirm
  echo "[✓] 后端: $SERVER_BIN"
else
  echo "[1/3] 跳过后端 (--skip-server)"
fi

echo ""
echo "[2/3] 同步内置后端到 client/resources/..."
if [[ ! -f "$SERVER_BIN" ]]; then
  echo "[错误] 找不到 $SERVER_BIN — 请先构建后端或去掉 --skip-server" >&2
  exit 1
fi
mkdir -p "$ROOT/client/resources"
cp -f "$SERVER_BIN" "$RES_BIN"
if [[ "$OS_UNAME" != MINGW* ]] && [[ "$OS_UNAME" != MSYS* ]] && [[ "$OS_UNAME" != CYGWIN* ]]; then
  chmod +x "$RES_BIN"
fi
echo "[✓] 已复制 -> $RES_BIN"

if [[ "$SKIP_CLIENT" != true ]]; then
  echo ""
  echo "[3/3] Electron 前端..."
  cd "$ROOT/client"
  npm ci
  npm run build
  echo "[✓] 产物目录: $ROOT/dist/（与 client/package.json directories.output 一致）"
else
  echo "[3/3] 跳过前端 (--skip-client)"
fi

echo ""
echo "================================================"
echo "  完成。说明见 docs/wiki/10-windows-distribution.md 与 docs/wiki/11-mac-linux-distribution.md"
echo "================================================"
