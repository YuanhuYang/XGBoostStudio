#!/usr/bin/env bash
# 供 scripts/build-all.sh 与 verify 脚本共用：下载 uv x86_64-apple-darwin 发行包并安装单一 uv 二进制。
# 用法：在已 set -euo pipefail 的脚本中 source 本文件后调用：
#   xs_fetch_uv_x86_64_apple_darwin <UV_TAG> <DEST_BIN_PATH>
xs_fetch_uv_x86_64_apple_darwin() {
  local UV_TAG="$1"
  local DEST="$2"
  (
    set -euo pipefail
    local UV_TMP UV_EXTRACTED
    UV_TMP="$(mktemp -d)"
    trap 'rm -rf "$UV_TMP"' EXIT
    if ! curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_TAG}/uv-x86_64-apple-darwin.tar.gz" \
      -o "$UV_TMP/uv.tgz"; then
      echo "[错误] 无法下载 uv x86_64 发行包（版本 ${UV_TAG}）。可设置环境变量 UV_VERSION 为已发布的 tag。" >&2
      exit 1
    fi
    if ! tar -xzf "$UV_TMP/uv.tgz" -C "$UV_TMP"; then
      echo "[错误] 解压 uv 发行包失败。" >&2
      exit 1
    fi
    UV_EXTRACTED="$(find "$UV_TMP" -name uv -type f ! -name '*.tgz' | head -n1)"
    if [[ -z "$UV_EXTRACTED" ]]; then
      echo "[错误] 解压后找不到 uv 二进制文件。" >&2
      exit 1
    fi
    mkdir -p "$(dirname "$DEST")"
    mv "$UV_EXTRACTED" "$DEST"
    chmod +x "$DEST"
    trap - EXIT
    rm -rf "$UV_TMP"
  )
}
