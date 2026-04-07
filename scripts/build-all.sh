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
    echo "[2b/3] 构建 x86_64 后端（Intel Mac 桌面包）..."
    # CI 的 `uv` 多为 arm64 单架构，`arch -x86_64 uv` 会报 Bad CPU type。改用官方 x86_64 uv 二进制（在 Apple Silicon 上由 Rosetta 执行）。
    UV_TAG="${UV_VERSION:-}"
    if [[ -z "$UV_TAG" ]] && command -v uv >/dev/null 2>&1; then
      UV_TAG="$(uv --version 2>/dev/null | sed -n 's/^uv \([0-9][0-9.]*\).*/\1/p' || true)"
    fi
    [[ -n "$UV_TAG" ]] || UV_TAG="0.8.14"
    UV_X64_DIR="$ROOT/.cache/uv-releases"
    UV_X64_BIN="$UV_X64_DIR/uv-x86_64-$UV_TAG"
    mkdir -p "$UV_X64_DIR"
    if [[ ! -x "$UV_X64_BIN" ]]; then
      echo "  下载 astral-sh/uv $UV_TAG (uv-x86_64-apple-darwin.tar.gz)..."
      UV_TMP="$(mktemp -d)"
      if ! curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_TAG}/uv-x86_64-apple-darwin.tar.gz" \
        -o "$UV_TMP/uv.tgz"; then
        rm -rf "$UV_TMP"
        echo "[错误] 无法下载 uv x86_64 发行包（版本 ${UV_TAG}）。可设置环境变量 UV_VERSION 为已发布的 tag。" >&2
        exit 1
      fi
      if ! tar -xzf "$UV_TMP/uv.tgz" -C "$UV_TMP"; then
        rm -rf "$UV_TMP"
        echo "[错误] 解压 uv 发行包失败。" >&2
        exit 1
      fi
      mv "$UV_TMP/uv" "$UV_X64_BIN"
      chmod +x "$UV_X64_BIN"
      rm -rf "$UV_TMP"
    fi
    if ! file "$UV_X64_BIN" | grep -q x86_64; then
      echo "[错误] 缓存的 uv 不是 x86_64: $(file "$UV_X64_BIN")" >&2
      exit 1
    fi
    if ! arch -x86_64 true 2>/dev/null; then
      echo "[错误] 本机无法使用 arch -x86_64（Rosetta），无法为 Intel Mac 构建 x86_64 后端。" >&2
      exit 1
    fi
    # 须使用 x86_64 专属 .venv；在 Rosetta bash 内调用 x86_64 uv，保证子进程与 wheel 一致为 x86_64（勿对 arm64-only 的 PATH 中 uv 使用 arch -x86_64）
    arch -x86_64 /bin/bash -c "
      set -euo pipefail
      cd '$ROOT/server'
      rm -rf build dist .venv-x64
      \"$UV_X64_BIN\" venv .venv-x64 --python 3.12
      export VIRTUAL_ENV='$ROOT/server/.venv-x64'
      export PATH=\"\$VIRTUAL_ENV/bin:\$PATH\"
      PY=\"\$VIRTUAL_ENV/bin/python3\"
      if ! file \"\$PY\" | grep -q x86_64; then
        echo '[错误] .venv-x64 解释器不是 x86_64，无法构建 Intel 后端。' >&2
        file \"\$PY\" || true
        exit 1
      fi
      \"$UV_X64_BIN\" sync --all-groups --frozen --active
      \"$UV_X64_BIN\" run --active pyinstaller build.spec --noconfirm
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
