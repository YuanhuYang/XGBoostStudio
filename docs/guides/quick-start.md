# XGBoost Studio 快速开始指南

> 三种场景的快速上手路径：**开发者** / **终端用户** / **Linux 浏览器访问**

---

## 👨‍💻 开发者快速开始

### 环境要求
- **Windows / macOS / Linux** 主机
- **uv** 包管理器（安装方式见 [部署说明](部署说明.md) B.1 节）
- **Node.js 18+** 和 **npm 9+**
- **Git** 版本控制

> uv 会自动下载并隔离管理 Python 3.12，**无需手动安装 Python**

### 第一步：克隆与依赖安装

```bash
# 1. 克隆仓库
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio

# 2. 安装后端依赖（uv 自动下载 Python 3.12 + 全部包）
cd server && uv sync && cd ..

# 3. 安装前端依赖
cd client && npm install && cd ..
```

### 第二步：启动开发环境

**方式 1：使用跨平台 Python 脚本（推荐，全平台一致）**

```bash
# 终端 1：启动后端服务
python scripts/dev.py --server
# 后端运行在 http://127.0.0.1:18899

# 终端 2：启动前端开发服务
python scripts/dev.py --client
# Windows/macOS → Electron 窗口弹出
# Linux         → 浏览器访问 http://localhost:5173

# 或者一次全部启动
python scripts/dev.py --all
```

**方式 2：使用 Shell 脚本（macOS / Linux）**

```bash
# 终端 1：启动后端
bash scripts/start.sh --server

# 终端 2：启动前端
bash scripts/start.sh --client
# Linux 自动切换为 Web 模式（npm run dev:web）
```

**方式 3：使用 PowerShell（Windows）**

```powershell
# PowerShell 1：启动后端
.\scripts\start.ps1 -Server

# PowerShell 2：启动前端
.\scripts\start.ps1 -Client
```

### 第三步：访问应用

| 平台 | 前端命令 | 访问方式 |
|------|---------|----------|
| Windows | `npm run dev` | Electron 窗口自动打开 |
| macOS | `npm run dev` | Electron 窗口自动打开 |
| Linux | `npm run dev:web` | 浏览器访问 `http://localhost:5173` |

验证后端正常：`curl http://127.0.0.1:18899/health` 应返回 `{"status":"ok"}`

### 可选：命令行全自动建模（xs-studio）

适合需要 **脚本化**、**无图形界面** 或与 **浏览器前端并行** 打开同一项目的场景：在 `server` 目录使用 `uv run python -m cli.main` 进入交互 REPL（默认会拉起本机 uvicorn），或使用 `run` 一键上传数据文件并跑 AutoML。

```bash
cd server
uv sync
uv run python -m cli.main
# 或：uv run python -m cli.main run /path/to/data.csv --skip-tuning
```

完整命令、PowerShell/macOS/Linux 差异、`--base-url` / `--keep-server`、前端深链说明见 **[xs-studio CLI 指南](xs-studio-cli.md)**；产品与 Wiki 侧说明见 [全自动建模与向导](../wiki/08-automl-wizard.md)（§2.2 命令行模式）。

---

## 📦 终端用户快速开始

### Windows 安装

1. 从 [Release 页面](https://github.com/YuanhuYang/XGBoostStudio/releases) 下载 `XGBoost-Studio-Setup-x.x.x.exe`
2. 双击运行，按提示完成安装（无需 Python 或任何配置）
3. 从桌面快捷方式或开始菜单启动应用

> **完全离线可用**：安装包已内置 Python 3.12 解释器 + 全部依赖库

### macOS 安装

1. 从 [Release 页面](https://github.com/YuanhuYang/XGBoostStudio/releases) 下载 `.dmg` 或 `.zip`（文件名以实际 Tag 为准）
2. 打开 dmg 后拖拽应用到 Applications（zip 则解压后按提示运行）
3. 若提示未签名应用，请在「系统设置 → 隐私与安全性」中放行或使用右键「打开」

> 细节与兼容性见 Wiki [`11-mac-linux-distribution.md`](../wiki/11-mac-linux-distribution.md)。

### Linux 用户（桌面包）

1. 从 [Release 页面](https://github.com/YuanhuYang/XGBoostStudio/releases) 下载 `.AppImage` 或 `.deb`
2. AppImage：`chmod +x` 后执行；deb：使用系统包管理器安装

> 亦可仅用浏览器开发态访问，见下文「Linux 浏览器访问」。桌面包说明见 [`11-mac-linux-distribution.md`](../wiki/11-mac-linux-distribution.md)。

---

## 🐧 Linux 浏览器访问

Linux 上不依赖 Electron，前端以纯 Web 方式运行，通过浏览器访问 `http://localhost:5173`。

### 开发调试模式（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio

# 2. 安装依赖
cd server && uv sync && cd ..
cd client && npm install && cd ..

# 3. 终端 1：启动后端
bash scripts/start.sh --server
# 或: cd server && uv run python main.py

# 4. 终端 2：启动前端（Web 模式）
bash scripts/start.sh --client
# 或: cd client && npm run dev:web

# 5. 浏览器访问 http://localhost:5173
```

### 后台一键启动

```bash
# 后端后台运行
cd server && nohup uv run python main.py > /tmp/xgb-server.log 2>&1 &
echo "后端 PID: $!"

# 切回根目录，前端 Web 模式前台运行
cd ../client && npm run dev:web

# 浏览器访问 http://localhost:5173
```

---

## 🔗 后续步骤

- **开发类**：[开发者指南](developers-guide.md) · [xs-studio 命令行](xs-studio-cli.md)
- **产品/功能类**：[产品概览（四模式、顶栏划分/主模型/专家对比、向导与数据处理默认教学）](../wiki/01-product-overview.md) · [技术架构](../wiki/02-architecture.md) · [全自动建模 AutoML（含命令行）](../wiki/08-automl-wizard.md)
- **归档需求/验收**（历史权威副本）：[`../archive/legacy-product/需求文档.md`](../archive/legacy-product/需求文档.md) · [`../archive/legacy-product/验收标准文档.md`](../archive/legacy-product/验收标准文档.md)
- **部署类**：[部署说明](部署说明.md)

---

## 💡 常见问题

### Q: 后端启动失败，提示"端口 18899 已占用"

```bash
# Windows:
netstat -ano | findstr :18899
taskkill /PID <PID> /F

# macOS/Linux:
lsof -i :18899
kill -9 <PID>
```

### Q: 前端无法连接后端

检查：
1. 后端是否启动：`curl http://127.0.0.1:18899/health`
2. 防火墙是否阻止了端口 18899
3. 检查浏览器控制台（F12）的网络错误

### Q: npm install 失败

尝试清理缓存：
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Q: Python 找不到依赖

使用 `uv` 重新同步：
```bash
cd server
uv sync --refresh
```

### Q: macOS 上 npm run dev 报 Electron 权限错误

首次运行时操作系统可能拦截未签名 Electron，在系统偏好设置 → 安全性与隐私中允许即可。
也可以使用 Web 模式替代：`cd client && npm run dev:web`

---

## 📚 更多资源

- [项目 README](../README.md) - 功能概览
- [GitHub Issues](https://github.com/YuanhuYang/XGBoostStudio/issues) - 问题反馈
- [开发者指南](developers-guide.md) - Git 流程、代码规范、测试
