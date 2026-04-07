# macOS / Linux 桌面分发

> **版本对应**：v0.5.x  
> **最后更新**：2026-04-07（与 GitHub Releases 全平台安装包对齐）

---

## 一、适用对象

| 角色 | 说明 |
|------|------|
| **终端用户** | 从 [GitHub Releases](https://github.com/YuanhuYang/XGBoostStudio/releases) 下载 **`.dmg` / `.zip`（macOS）** 或 **`.AppImage` / `.deb`（Linux）**。 |
| **研发 / 打包** | 在 **macOS** 或 **Linux x64** 上执行 [`scripts/build-all.sh`](../../scripts/build-all.sh)，在仓库根目录 `dist/` 生成对应平台安装包。 |

Windows 用户请见 [`10-windows-distribution.md`](10-windows-distribution.md)。

---

## 二、系统要求与兼容性边界

| 项目 | macOS | Linux |
|------|-------|-------|
| 架构 | 与 CI 构建机一致（`macos-latest`，当前多为 **Apple Silicon** 或 **Intel**，以 Release 资产文件名中的 `-arm64` / `-x64` 为准） | **x64**（与 `ubuntu-latest` 构建环境一致） |
| 系统版本 | 建议较新版本；未签名应用首次打开可能需在 **系统设置 → 隐私与安全性** 中放行 | 与构建所用 **glibc** 版本相关；极老发行版可能无法运行 **AppImage** / **deb** |
| 网络 | 默认后端监听 `127.0.0.1:18899`，一般无需公网 | 同左 |
| 内置后端 | PyInstaller 单文件 `xgboost-server`（无扩展名），由 Electron 主进程拉起（与 Windows 的 `xgboost-server.exe` 等价） | 同左 |

**代码签名与公证（macOS）**：当前 CI 产物**未**配置 Apple 开发者证书与公证。企业或公网分发场景需单独接入签名流水线；个人用户可使用右键「打开」或按系统提示放行。

---

## 三、从 Release 安装（终端用户）

1. 打开仓库 **Releases** 页面，选择对应 **Tag**（如 `v0.5.0`）。
2. 下载本机平台资产：
   - **macOS**：优先 **`.dmg`**（拖拽安装）；**`.zip`** 为压缩包形态。
   - **Linux**：**`.AppImage`** 需 `chmod +x` 后执行；**`.deb`** 使用系统包管理器安装（如 `sudo dpkg -i …`）。
3. 启动应用后，内置后端应自动启动；若长时间无法连接，请确认 **18899** 端口未被占用。

---

## 四、本地一键构建（研发）

在仓库根目录：

```bash
chmod +x scripts/build-all.sh
./scripts/build-all.sh
```

流程概要：

1. `uv sync` + PyInstaller：生成 `server/dist/xgboost-server`（无扩展名）。
2. 复制到 `client/resources/xgboost-server`（供 `electron-builder` 的 `mac` / `linux` → `extraResources` 使用）。
3. `npm ci` + `npm run build`：输出到仓库根目录 **`dist/`**（`dmg`/`zip` 或 `AppImage`/`deb`，取决于当前 OS）。

可选参数：`--skip-server`、`--skip-client`（与 Windows 脚本语义类似）。

---

## 五、与 Windows 文档的差异摘要

| 项 | Windows | macOS / Linux |
|----|---------|----------------|
| 一键脚本 | `scripts/build-all.ps1` | `scripts/build-all.sh` |
| 内置后端文件名 | `xgboost-server.exe` | `xgboost-server` |
| 典型产物 | NSIS + portable `.exe` | dmg + zip / AppImage + deb |

---

## 六、版本历史

| 日期 | 摘要 |
|------|------|
| 2026-04-07 | 初版：与全平台 Release、内置后端自动启动、`build-all.sh` 对齐 |
