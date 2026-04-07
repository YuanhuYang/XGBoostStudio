# macOS 桌面分发与 Linux 服务端（无 Linux Electron）

> **版本对应**：v0.5.x  
> **最后更新**：2026-04-07（Linux 不发布 Electron；Release 仅提供后端 tar.gz）

---

## 一、适用对象

| 角色 | 说明 |
|------|------|
| **macOS 终端用户** | 从 [GitHub Releases](https://github.com/YuanhuYang/XGBoostStudio/releases) 下载 **`.dmg` / `.zip`**。 |
| **Linux 用户** | **无 Electron 安装包**。Release 提供 **`xgboost-server-<tag>-linux-x64.tar.gz`**（PyInstaller 单文件后端）；配合 **浏览器**（`npm run dev:web` 等）与 **CLI**（`uv` / `xs-studio`）使用，见下文第三节。 |
| **研发** | **macOS**：[`scripts/build-all.sh`](../../scripts/build-all.sh) 生成 `dist/` 下 dmg/zip。**Linux**：同一脚本仅构建后端并同步 `client/resources/`（跳过 Electron）；CI 中 Linux job 只打 tar.gz。 |

Windows 用户请见 [`10-windows-distribution.md`](10-windows-distribution.md)。

---

## 二、macOS：系统要求与 Release 安装

| 项目 | 说明 |
|------|------|
| 架构 | Release 同时提供 **Apple Silicon（`-arm64`）** 与 **Intel（`-x64`）** 的 `.dmg` / `.zip`；**Intel Mac 必须下载带 `-x64` 的文件**，勿用仅含 `-arm64` 的包。 |
| 签名 / 公证 | CI 产物**未**签名与公证；首次打开可能需在 **系统设置 → 隐私与安全性** 中放行或使用右键「打开」。 |
| 内置后端 | PyInstaller 单文件 `xgboost-server`，由 Electron **extraResources** 提供，主进程自动拉起。 |

**安装步骤**：在 Releases 选择 Tag → 下载 `.dmg` 或 `.zip` → 安装或解压后启动；若无法连接后端，检查 **18899** 端口是否被占用。

---

## 三、Linux：Release 后端 tar + 浏览器 + CLI

### 3.1 从 Release 获取后端

1. 下载 **`xgboost-server-vX.Y.Z-linux-x64.tar.gz`**（版本号与 Tag 一致）。
2. 解压：`tar -xzf xgboost-server-vX.Y.Z-linux-x64.tar.gz`
3. `chmod +x xgboost-server` 后启动：`./xgboost-server`（监听 `127.0.0.1:18899`，与桌面包一致）。

**兼容性**：二进制在 **ubuntu-latest** 类环境上构建，与当时 **glibc** 版本绑定；过旧发行版可能无法运行，可改用源码 + `uv`（见部署说明 Part B）。

### 3.2 浏览器访问 UI

Linux **不**随 Release 附带前端静态包时，需本地克隆仓库并安装 Node：

```bash
cd client && npm ci && npm run dev:web
```

浏览器打开 `http://localhost:5173`，前提是 **后端已监听 18899**（上一步 tar 内二进制或 `cd server && uv run python main.py`）。

### 3.3 CLI

在克隆的仓库中：`cd server && uv sync`，使用 **`uv run xs-studio`** 或 **`uv run python -m cli.main`**（详见 [`xs-studio CLI 指南`](../guides/xs-studio-cli.md)）。CLI 与后端共用同一套 API，可与浏览器模式并存。

---

## 四、本地一键脚本（`build-all.sh`）

```bash
chmod +x scripts/build-all.sh
./scripts/build-all.sh
```

| 平台 | 行为 |
|------|------|
| **macOS** | 在 **Apple Silicon** 上：默认 `.venv` 原生 PyInstaller → `xgboost-server-arm64`；Intel 后端使用 **独立 `server/.venv-x64`**（Rosetta 下 `arch -x86_64 uv venv` + `uv sync --active`，避免 arm64 的 Pillow 等 `.so` 混入导致 PyInstaller `IncompatibleBinaryArchError`）→ `xgboost-server-x64`；然后 `npm ci` + `npm run build` → 仓库根 `dist/` 下 arm64/x64 的 dmg/zip。 |
| **Linux** | 仅 PyInstaller + 同步 `client/resources/xgboost-server`；**不**执行 Electron 打包。随后请自行 `npm run dev:web` 或仅用后端/CLI。 |

可选：`--skip-server`、`--skip-client`。

---

## 五、与 Windows 的差异摘要

| 项 | Windows | macOS | Linux |
|----|---------|-------|-------|
| 一键脚本 | `build-all.ps1` | `build-all.sh` | `build-all.sh`（仅后端） |
| Release 典型资产 | NSIS + portable `.exe` | **`-arm64` / `-x64` 各一份** `.dmg` + `.zip`（共 4 个桌面包） | `xgboost-server-*-linux-x64.tar.gz` |
| Electron | 有 | 有 | **无** |

---

## 六、版本历史

| 日期 | 摘要 |
|------|------|
| 2026-04-07 | 初版：与全平台 Release、内置后端自动启动、`build-all.sh` 对齐 |
| 2026-04-07 | Linux 取消 AppImage/deb；Release 改为后端 tar.gz；文档区分 mac 桌面包与 Linux 服务端+浏览器 |
| 2026-04-07 | 明确 macOS 双架构产物：Intel 选 `-x64`，Apple Silicon 选 `-arm64`。 |
