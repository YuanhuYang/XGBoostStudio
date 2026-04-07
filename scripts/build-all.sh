#!/usr/bin/env bash
# XGBoost Studio 一键构建（Bash）
# - macOS：PyInstaller 后端 + Electron 安装包（与 CI build-macos 对齐）
# - Linux：仅 PyInstaller 后端 + 同步 resources（不打 Electron；浏览器 + CLI 见 Wiki）
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

if [[ "$OS_UNAME" == Darwin ]]; then
  # Electron 同时打 arm64 / x64 时，内置 PyInstaller 须与目标架构一致（见 client/package.json mac.extraResources）
  ARM64_OUT="$ROOT/client/resources/xgboost-server-arm64"
  X64_OUT="$ROOT/client/resources/xgboost-server-x64"
  if [[ "$(uname -m)" == arm64 ]]; then
    cp -f "$SERVER_BIN" "$ARM64_OUT"
    chmod +x "$ARM64_OUT"
    echo "[✓] 已复制 -> $ARM64_OUT (arm64)"
    echo "[2b/3] Rosetta 下构建 x86_64 后端（Intel Mac 桌面包）..."
    if ! arch -x86_64 true 2>/dev/null; then
      echo "[错误] 无法执行 arch -x86_64，不能生成 x64 后端；macOS 发布包请在 Apple Silicon 或 GitHub Actions macos-latest 上构建。" >&2
      exit 1
    fi
    arch -x86_64 /bin/bash -c "
      set -euo pipefail
      cd '$ROOT/server'
      rm -rf build dist
      uv sync --all-groups --frozen
      uv run pyinstaller build.spec --noconfirm
    "
    cp -f "$ROOT/server/dist/xgboost-server" "$X64_OUT"
    chmod +x "$X64_OUT"
    echo "[✓] 已复制 -> $X64_OUT (x64)"
  else
    echo "[错误] macOS 双架构发布需在 arm64 Mac 上执行本脚本（与 CI macos-latest 一致）。Intel Mac 本地请使用开发模式或仅构建单一架构。" >&2
    exit 1
  fi
elif [[ "$OS_UNAME" == Linux ]]; then
  cp -f "$SERVER_BIN" "$RES_BIN"
  chmod +x "$RES_BIN"
  echo "[✓] 已复制 -> $RES_BIN"
else
  cp -f "$SERVER_BIN" "$RES_BIN"
  if [[ "$OS_UNAME" != MINGW* ]] && [[ "$OS_UNAME" != MSYS* ]] && [[ "$OS_UNAME" != CYGWIN* ]]; then
    chmod +x "$RES_BIN"
  fi
  echo "[✓] 已复制 -> $RES_BIN"
fi

if [[ "$SKIP_CLIENT" != true ]]; then
  echo ""
  echo "[3/3] 前端..."
  cd "$ROOT/client"
  if [[ "$OS_UNAME" == Linux ]]; then
    echo "[✓] Linux 跳过 Electron 打包（产品策略）。浏览器访问: npm ci && npm run dev:web（另需已启动后端，见 docs/wiki/11-mac-linux-distribution.md）"
  else
    npm ci
    npm run build
    echo "[✓] 产物目录: $ROOT/dist/（与 client/package.json directories.output 一致）"
  fi
else
  echo "[3/3] 跳过前端 (--skip-client)"
fi

echo ""
echo "================================================"
echo "  完成。说明见 docs/wiki/10-windows-distribution.md 与 docs/wiki/11-mac-linux-distribution.md"
echo "================================================"
