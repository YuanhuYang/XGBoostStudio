# Windows 分发：安装包与免安装便携版

> **版本对应**：v0.5.x（与 [`README.md`](../../README.md) / 本目录 `01-product-overview` 一致）  
> **最后更新**：2026-04-07（初版：NSIS + portable 双产物与安装指引）

---

## 一、适用对象

| 角色 | 说明 |
|------|------|
| **终端用户** | 从发布页或内网镜像获取已构建的 `.exe`，按下文选择安装版或免安装版。 |
| **研发 / 打包** | 在 **Windows x64** 开发机上执行一键脚本，在仓库根目录 `dist\` 生成两种 Windows 产物。 |

本文仅展开 **Windows x64**。**macOS / Linux** 桌面安装包与 Release 说明见 [`11-mac-linux-distribution.md`](11-mac-linux-distribution.md)（与 [`client/package.json`](../../client/package.json) 中 `mac` / `linux` 及 GitHub Actions `release.yml` 对齐）。

---

## 二、系统要求

- **操作系统**：Windows 10 / 11，64 位。
- **磁盘空间**：建议至少预留 **2 GB** 可用空间（应用、内置 Python 运行时、数据集与 SQLite 库会持续增长，视使用而定）。
- **网络**：默认后端监听 **本机回环** `127.0.0.1:18899`（见 [`02-architecture.md`](02-architecture.md)）；一般无需公网，但企业代理或安全软件可能拦截本地端口通信，见下文「常见问题」。
- **权限**：安装版若安装到 `Program Files`，后续对安装目录的写入受 UAC 限制；应用内用户数据主要走 Electron 默认 **`userData`** 目录（见第五节），需保证当前 Windows 用户对该目录可写。

---

## 三、如何一键构建（研发）

在项目根目录执行：

```powershell
.\scripts\build-all.ps1
```

流程概要：

1. **PyInstaller** 将 Python 服务打成 `server\dist\xgboost-server.exe`（可用 `-SkipServer` 跳过，前提是已有该文件）。
2. 复制到 `client\resources\xgboost-server.exe`，供 Electron 打包进 `extraResources`。
3. 在 `client` 下执行 `npm run build`（`electron-vite build` + `electron-builder`），**一次**生成 Windows 的 **NSIS 安装包** 与 **portable 免安装包**。

**产物目录（重要）**：`electron-builder` 的 `directories.output` 指向仓库根下的 **`dist\`**，不是 `client\dist\`。

**典型文件名**（以 `package.json` 中 `version` 与 `productName` 为准，`electron-builder` 默认规则；**请以实际构建输出为准**）：

| 类型 | 常见文件名模式 |
|------|----------------|
| NSIS 安装包 | `XGBoost Studio Setup {version}.exe` |
| portable 免安装 | `XGBoost Studio {version}.exe`（**不含** `Setup` 字样） |

同次构建还可能生成 `win-unpacked\` 等中间目录，发布时通常只需上述两个 `.exe` 之一或全部，按场景选择。

---

## 四、安装版（NSIS）

### 4.1 适用场景

需要「开始菜单 / 桌面快捷方式」、固定安装路径、与系统「应用和功能」列表中的卸载入口一致时，推荐使用安装包。

### 4.2 安装步骤

1. 双击 **`XGBoost Studio Setup {version}.exe`**。
2. 安装向导为**非一键安装**（`oneClick: false`），可按提示**更改安装目录**。
3. 按选项生成**桌面**与**开始菜单**快捷方式（与 [`client/package.json`](../../client/package.json) 中 `nsis` 配置一致）。
4. 安装完成后从快捷方式启动 **XGBoost Studio**。

### 4.3 卸载

在 **Windows 设置 → 应用 → 已安装的应用**（或「程序和功能」）中找到 **XGBoost Studio**，选择卸载，按向导完成即可。

---

## 五、免安装版（portable）

### 5.1 适用场景

无管理员权限、希望放在固定文件夹或移动磁盘、或不想写入「已安装应用」列表时，可使用 portable 可执行文件。

### 5.2 使用步骤

1. 将 **`XGBoost Studio {version}.exe`** 复制到目标文件夹（建议路径中**避免**过深目录、特殊字符或与杀毒实时扫描冲突的位置）。
2. **双击运行**。无需先执行 NSIS 安装向导。

### 5.3 与安装版在数据目录上的关系

当前主进程未根据 portable 单独改写 `app.getPath('userData')`（见 [`client/electron/main.ts`](../../client/electron/main.ts) 中对 `userData` 的用法）。因此 **SQLite 元数据、首次启动标记等仍默认落在当前 Windows 用户的 Electron 用户数据目录下**，与是否通过 NSIS 安装**无本质区别**；区别主要在于**程序文件**是否通过安装程序注册到系统。

若需「单目录绿色版」（程序与数据均在同一文件夹），属于产品级增强，需另行开发（例如根据 `process.env.PORTABLE_EXECUTABLE_DIR` 设置 `userData`），**当前版本不承诺该行为**。

---

## 六、内置后端与 Python

两种 Windows 产物均通过 `extraResources` 内置 **`xgboost-server.exe`**（PyInstaller 单文件），由 Electron 主进程拉起（见 [`02-architecture.md`](02-architecture.md) 进程模型）。

**终端用户无需单独安装 Python 或 pip 依赖**；这与根目录 [`README.md`](../../README.md) 及 [`开发规范.md`](../guides/开发规范.md) 中的打包说明一致。

---

## 七、常见问题

| 现象 | 可能原因 | 建议处理 |
|------|----------|----------|
| 启动后**整块窗口纯白**（仅标题栏正常） | 部分显卡驱动下 Chromium/Electron GPU 合成异常；或渲染资源加载失败、渲染进程崩溃 | 快捷方式「目标」末尾追加 `--disable-gpu` 或设置环境变量 **`XGBOOST_STUDIO_DISABLE_GPU=1`** 后启动；查看 **`%APPDATA%\xgboost-studio\main-process-diagnostics.log`**（`did-fail-load` / `render-process-gone` 会写入）。 |
| 启动后长时间白屏或无法连接 | 本机 **18899** 端口被占用，或后端进程被拦截 | 关闭占用端口的其它程序；查看任务管理器中是否有残留 `xgboost-server.exe`；企业安全软件是否拦截子进程。 |
| Windows 防火墙弹窗 | 首次监听端口时系统提示 | 若仅本机使用，可选择「专用网络允许」；架构上为本地 HTTP + SSE，见 [`02-architecture.md`](02-architecture.md)。 |
| 杀毒报毒 / 自动隔离 | 未签名 exe、PyInstaller 打包行为易被启发式误判 | 将产品加入信任区；研发侧可规划代码签名（当前 `signAndEditExecutable: false`）。 |
| 无法写入数据 / 导入失败 | `userData` 或临时目录无写权限 | 检查 `%APPDATA%` 是否被策略重定向为只读；尝试以普通用户目录登录测试。 |
| 仅构建了前端但缺少后端 | 未先产生 `server\dist\xgboost-server.exe` | 先执行 `.\scripts\build-server.ps1` 或完整 `build-all.ps1`；确保 `client\resources\xgboost-server.exe` 存在后再 `npm run build`。 |

---

## 八、与其它文档的交叉引用

- 整体架构与端口：**[`02-architecture.md`](02-architecture.md)**  
- 开发与打包流程（含 PyInstaller 命令）：**[`开发规范.md`](../guides/开发规范.md)** 第七节  
- 部署与产物目录说明：**[`部署说明.md`](../guides/部署说明.md)**

---

## 版本历史

| 日期 | 摘要 |
|------|------|
| 2026-04-07 | v0.5.0：安装包文件名与 `client/package.json` **0.5.0** 一致（如 `XGBoost-Studio-Setup-0.5.0.exe`）；文首「版本对应」与 v0.5.x 对齐。 |
| 2026-04-07 | 初版：Windows x64 下 NSIS + portable 双产物说明、构建路径、安装与免安装使用指引、FAQ。 |
| 2026-04-07 | macOS/Linux 分发改由 [`11-mac-linux-distribution.md`](11-mac-linux-distribution.md) 描述；本文仅 Windows。 |
| 2026-04-07 | FAQ：纯白窗口与 `main-process-diagnostics.log`、GPU 降级环境变量说明。 |
