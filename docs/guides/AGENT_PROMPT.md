# XGBoost Studio — AI 一键生成总指令

> **使用方式**：新建 AI 对话时，可将本文件作为仓库上下文参考。  
> **重要（v0.5）**：主干已实现 **FastAPI 全量路由、`routers/`、`services/`、`Electron + React` 前端、四模式导航、应用内文档中心**。请勿按文中旧「阶段 0 空壳」清单从零重建；新需求以 **[`docs/wiki/02-architecture.md`](../wiki/02-architecture.md)** 与对应迭代 **`章程.md`** 为准。

---

## 0. 核心指令

```
你是一个专业的全栈开发工程师。请根据本文档的所有规格，
从阶段 0 开始，连续自主完成所有开发任务，直到产出可商用发布的 Windows 安装包。

约束：
- 不需要向我确认任何技术选型，所有技术栈已在本文档中确定
- 不需要我点击确认或审批，遇到选择时按照本文档的规范自行决策
- 每完成一个阶段，自动执行 git commit，然后继续下一阶段
- 如遇报错，自行分析并修复，不要停下来询问
- 所有 Python 命令必须通过 `uv run` 执行，不能直接调用 `python`
- 严格按照"六、开发顺序"中的阶段顺序推进，不能跳跃
```

---

## 1. 项目概述

| 项目 | 内容 |
|------|------|
| 产品名称 | XGBoost Studio |
| 架构 | 桌面 C/S，Electron 前端 + Python 后端进程 |
| 目标平台 | Windows 10/11 64位 |
| 最终产物 | `dist/XGBoost Studio Setup x.x.x.exe`（自包含，无需用户安装 Python） |
| 仓库地址 | https://github.com/YuanhuYang/XGBoostStudio |

---

## 2. 技术栈（固定，不可更改）

### 前端（`client/` 目录）

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | 28 | 桌面容器，管理窗口和 Python 进程生命周期 |
| React | 18 | UI 框架 |
| TypeScript | 5 | 类型安全 |
| Vite | 5 | 构建工具（`electron-vite` 模板） |
| Ant Design | 5 | UI 组件库 |
| ECharts | 5 | 图表（所有图表统一用此库） |
| Zustand | 4 | 全局状态管理 |
| axios | 1.x | HTTP 客户端 |

### 后端（`server/` 目录，uv 管理）

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.12（uv 管理） | 运行时 |
| FastAPI | 0.135+ | HTTP + SSE API 服务 |
| uvicorn | 0.42+ | ASGI 服务器 |
| XGBoost | 3.2+ | 核心建模库 |
| Pandas | 3.0+ | 数据处理 |
| scikit-learn | 1.8+ | 预处理、评估、基线模型 |
| SHAP | 0.51+ | 模型可解释性 |
| Optuna | 4.8+ | 超参数调优 |
| statsmodels | 0.14+ | 统计检验、分布拟合 |
| scipy | 1.17+ | 科学计算 |
| openpyxl | 3.1+ | Excel 读写 |
| aiofiles | 25.1+ | 异步文件操作 |
| SQLAlchemy | 2.0+ | ORM（SQLite） |

### 通信协议

- **HTTP REST**：所有常规 API，端口 `18899`，仅监听 `127.0.0.1`
- **SSE（Server-Sent Events）**：模型训练进度、调优进度实时推送
- **数据格式**：JSON，字符集 UTF-8

### 打包方式

- Python 后端 → `PyInstaller`（`server/dist/xgboost-server.exe`，包含完整 Python + 所有包）
- Electron 前端 + 后端 exe → `electron-builder`（`dist/XGBoost Studio Setup x.x.x.exe`）

---

## 3. 仓库现状（v0.5 主干，勿重复造轮子）

- [x] **`server/main.py`**：FastAPI 入口，CORS、生命周期、`routers` 全量注册，监听 `127.0.0.1:18899`
- [x] **`server/routers/`**：`datasets`、`params`、`training`、`models`、`tuning`、`reports`、`prediction`、`wizard`、`automl`
- [x] **`server/services/`**：训练、评估、调优、报告、数据集、特征、泄露、AutoML、向导编排等
- [x] **`server/db/`**：SQLAlchemy + SQLite；运行时日志/数据见 `%APPDATA%\XGBoostStudio`（与代码一致）
- [x] **`server/cli/`**：`xs-studio` 交互 REPL + `run` 子命令
- [x] **`client/`**：electron-vite；`src/pages/` 含 Welcome、SmartWorkflow、DataImport、各业务页、**Documentation**、**ExpertWorkbench**、**LearningWorkbench**；`MainLayout` 四模式导航
- [x] **`client/src/constants/docsManifest.ts`**：应用内文档中心篇目
- [x] **`scripts/build-all.ps1`** 等：Windows 一键构建（与 [`docs/wiki/10-windows-distribution.md`](../wiki/10-windows-distribution.md) 一致）
- [x] **历史需求/验收 PDF**：见 [`docs/archive/legacy-product/`](../archive/legacy-product/)

---

## 4. 目录结构规范（与当前仓库一致）

```
XGBoostStudio/
├── README.md
├── docs/                       # Wiki、guides、iterations、archive
├── client/
│   ├── electron/               # main.ts、preload.ts、server-manager.ts
│   └── src/
│       ├── api/
│       ├── components/         # MainLayout、ModeSwitcher、…
│       ├── pages/              # Welcome、Documentation、SmartWorkflow、DataImport、…
│       ├── store/appStore.ts   # workflowMode: guided | preprocess | learning | expert
│       ├── docs/docSources.ts  # 构建期 glob 打入 Wiki/guides/README
│       └── constants/docsManifest.ts
├── server/
│   ├── main.py
│   ├── routers/
│   ├── services/
│   ├── schemas/
│   ├── db/
│   ├── cli/
│   ├── tests/
│   ├── pyproject.toml
│   └── build.spec              # PyInstaller
└── scripts/                    # build-all.ps1、build-server.ps1、build-client.ps1
```

---

## 5. 关键规范

### 5.1 Python 运行规范（重要）

```powershell
# ✅ 所有 Python 命令必须用 uv run
cd server
uv run python main.py
uv run python -m pytest

# ❌ 禁止直接调用 python（可能误用 conda base，有 DLL 冲突）
python main.py
```

### 5.2 后端代码规范

```
server/
  routers/     → 只做参数校验 + 调用 service，不写业务逻辑
  services/    → 纯 Python 业务函数，不依赖 FastAPI
  schemas/     → Pydantic BaseModel 请求/响应模型
  db/          → SQLAlchemy ORM，SQLite 存储
```

- 所有 API 函数必须有类型注解
- 路由层使用 `HTTPException` 返回错误：`{"detail": "错误信息"}`
- 文件路径只存相对路径到 SQLite，不存绝对路径
- 训练/调优进度用 `StreamingResponse` + SSE：`data: {json}\n\n`

### 5.3 前端代码规范

- 所有 API 调用封装在 `src/api/`，页面组件不直接调用 axios
- 禁止使用 TypeScript `any`
- 图表配置抽离为独立函数，不内联在 JSX
- 所有异步操作必须有 loading 状态（Ant Design `Spin` 或 `Skeleton`）

### 5.4 提交规范

```bash
feat(data-import): 实现 CSV/Excel 拖拽上传 [AC-1-01, AC-1-02]
fix(model-eval): 修复分类混淆矩阵计算错误 [AC-6-03]
chore(global): 初始化 Electron+React+FastAPI 脚手架
```

---

## 6. 开发顺序（历史清单已废弃）

以下说明取代原「阶段 0～5」逐条勾选清单（原清单假设从零搭建空壳，**与 v0.5 主干矛盾**）。

**新增功能或修缺陷时的推荐顺序**

1. 在对应迭代目录写入/更新 **`章程.md`**，冻结范围与 DoD。  
2. 以 **[`docs/wiki/02-architecture.md`](../wiki/02-architecture.md)** 为结构准绳：后端改动走 `routers/` → `services/` → `schemas/`/`db/`；前端走 `api/` → `pages/`/`components/`，状态进 `appStore`。  
3. **四模式导航**：任何新页面须声明在哪种 `workflowMode` 下可见，并更新 `MainLayout` 菜单与 Ctrl+K 过滤逻辑（若适用）。  
4. 同步 **测试**（`server`：`uv run pytest`；`client`：`npm run test:unit` / `typecheck`）。  
5. 若影响用户可见行为，更新相关 **Wiki**（至少 `01-product-overview` / `02-architecture` 之一）与应用内 **`docsManifest`**（若新增独立 `.md` 且需进文档中心）。

**历史 AC 与模块级验收**（可选阅读，不作为当前接口唯一依据）：[`docs/archive/legacy-product/验收标准文档.md`](../archive/legacy-product/验收标准文档.md)、[`需求文档.md`](../archive/legacy-product/需求文档.md)。

---

## 7. 参考文件位置

| 文件 | 说明 |
|------|------|
| [`docs/wiki/01-product-overview.md`](../wiki/01-product-overview.md) | 产品定位与四种体验模式 |
| [`docs/wiki/02-architecture.md`](../wiki/02-architecture.md) | 前后端模块、API、应用内文档中心 |
| [`docs/guides/开发规范.md`](开发规范.md) | 提交与工程约定 |
| [`docs/guides/部署说明.md`](部署说明.md) | 安装与环境 |
| [`docs/archive/legacy-product/`](../archive/legacy-product/) | 历史需求与验收材料 |
| `server/pyproject.toml` | Python 依赖声明 |

---

## 8. 测试数据

测试与夹具以仓库内 **`server/tests/`** 与 **`server/tests/data/`** 为准；若需补充场景，优先与现有 pytest 用例风格一致。

---

*本文件保留为 AI/自动化参考入口；实施请以当前代码与 Wiki 为准。*