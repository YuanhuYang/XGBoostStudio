#!/usr/bin/env bash
# 在非 macOS 环境可运行：校验 build-all.sh 语法，并实测 uv x86_64-apple-darwin 发行包解压逻辑
#（与 macOS CI 中 Intel 后端引导一致）。无法在 Windows/Linux 上替代完整 PyInstaller/Electron mac 构建。
# 用法（仓库根目录）：bash scripts/verify-macos-build-prep.sh
# 环境变量：
#   UV_VERIFY_TAG   强制用于本检查的 uv 版本 tag（默认 0.11.3，覆盖「含子目录」的常见布局）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/fetch-uv-x86_64-apple-darwin.sh
source "$ROOT/scripts/lib/fetch-uv-x86_64-apple-darwin.sh"

echo "==> bash -n scripts/build-all.sh"
bash -n "$ROOT/scripts/build-all.sh"

VERIFY_TAG="${UV_VERIFY_TAG:-0.11.3}"
DEST_BIN="$(mktemp)"
rm -f "$DEST_BIN"
echo "==> 试拉取并解压 uv ${VERIFY_TAG}（darwin x86_64，与 build-macos 脚本逻辑一致）…"
xs_fetch_uv_x86_64_apple_darwin "$VERIFY_TAG" "$DEST_BIN"
if [[ ! -s "$DEST_BIN" ]]; then
  echo "[错误] 安装后的 uv 为空文件。" >&2
  exit 1
fi
rm -f "$DEST_BIN"

# 与 build-all.sh 默认回退一致时再测一次扁平布局（旧包）
LEGACY_TAG="0.8.14"
DEST2="$(mktemp)"
rm -f "$DEST2"
echo "==> 试拉取并解压 uv ${LEGACY_TAG}（兼容旧 tarball 布局）…"
xs_fetch_uv_x86_64_apple_darwin "$LEGACY_TAG" "$DEST2"
if [[ ! -s "$DEST2" ]]; then
  echo "[错误] 安装后的 uv 为空文件。" >&2
  exit 1
fi
rm -f "$DEST2"

echo "[✓] macOS 构建前置检查通过（语法 + uv 发行包解压路径）。"
