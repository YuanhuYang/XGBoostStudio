# XGBoost Studio

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey" />
  <img src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/electron-28-47848F?logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/xgboost-3.2-FF6600" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

> **无需编写代码，全流程可视化完成 XGBoost 建模、调优、解释与预测。**  
> 面向数据分析师、算法工程师、科研人员，支持小白向导、学习、专家三种体验模式。

---

## ✨ 功能亮点

| 模块 | 核心能力 |
|------|----------|
| 🤖 **智能向导** | 6 步全流程引导（数据→预处理→划分→参数→训练→报告），AI 推荐参数，自然语言结果解读，一键生成 PDF 报告 |
| 📥 **数据导入** | CSV / Excel 拖拽上传，多 Sheet 选择，分页预览，数据质量评分，一键去重，缺失率警示 |
| 🔍 **特征分析** | 分布检验（Shapiro-Wilk）、Pearson/Spearman 相关热力图、VIF 多重共线性、ANOVA 目标关系分析 |
| 🛠 **特征工程** | 缺失值填充（均值/中位数/众数）、异常值截断、Label/One-Hot 编码、StandardScaler/MinMax 缩放、PCA 降维、训练/测试集划分 |
| ⚙️ **参数配置** | 9 个 XGBoost 核心超参数可视化配置，规则推荐引擎，参数解释卡片，快速/均衡/深度三预设 |
| 🚀 **模型训练** | SSE 实时进度流，训练/验证曲线 ECharts 渲染，日志滚动，过拟合实时预警 |
| 📊 **模型评估** | 混淆矩阵热力图、ROC 曲线（AUC）、残差散点图、SHAP Top-20 重要性、学习曲线，自动跳转加载 |
| 🎯 **超参数调优** | Optuna TPE/随机搜索，SSE 流式 Trial 进度，最优参数自动保存模型 |
| 🗂 **模型管理** | 模型注册表，重命名/标签/导出，多模型雷达图对比 |
| 📄 **分析报告** | reportlab 生成深色主题 PDF 报告，系统默认 PDF 阅读器预览，一键下载，支持自定义章节 |
| 🤔 **交互预测** | 单样本 JSON 输入（含 SHAP 贡献可视化）+ 批量文件预测 + CSV 结果下载 |

---

## 🎭 三层用户体验

| 模式 | 适合人群 | 入口 |
|------|---------|------|
| 🎯 **向导模式** | 业务人员、无技术背景 | 智能向导页（默认），6 步点击完成全流程 |
| 📚 **学习模式** | 在校生、算法自学者 | 向导页顶部切换开关，每步展开参数教学卡片 |
| ⚙️ **专家模式** | 数据科学家、算法工程师 | 左侧完整十页专业侧边栏，全局状态自动传递 |

三种模式共享同一后端与数据流，全局状态（`activeDatasetId` / `activeSplitId` / `activeModelId`）在所有页面自动传递，无需手动复制 ID。

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron 28 主进程                         │
│  server-manager.ts 管理 Python 子进程生命周期 │ IPC contextBridge │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP REST + Server-Sent Events (SSE)
┌──────────────────────────▼──────────────────────────────────┐
│              React 18 + Ant Design 5 渲染进程                  │
│  Zustand (全局状态) │ ECharts 5 (图表) │ axios (HTTP 客户端)   │
└──────────────────────────┬──────────────────────────────────┘
                           │ 127.0.0.1:18899
┌──────────────────────────▼──────────────────────────────────┐
│            FastAPI 0.135 后端（Python 3.12）                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  路由层 (routers/)                                    │   │
│  │  datasets · params · training · models · tuning      │   │
│  │  prediction · reports · wizard                       │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │  服务层 (services/)                                   │   │
│  │  dataset · feature · training · eval · tuning        │   │
│  │  params · prediction · report · wizard               │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │  数据层 (db/)                                         │   │
│  │  SQLAlchemy 2.0 + SQLite · XGBoost 3.2               │   │
│  │  SHAP 0.51 · Optuna 4.8 · reportlab 4.0              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**运行时数据路径**（Windows）：`%APPDATA%\XGBoostStudio\`

| 子目录/文件 | 内容 |
|------------|------|
| `app.db` | SQLite 元数据（数据集、模型、划分记录） |
| `datasets/` | 上传的原始 CSV/Excel 文件 |
| `models/` | 训练保存的 XGBoost `.ubj` 模型文件 |
| `reports/` | 生成的 PDF 报告文件 |

---

## 🚀 快速开始

### 终端用户（零技术门槛）

1. 下载 `XGBoost Studio Setup x.x.x.exe`
2. 双击安装，按提示完成
3. 从桌面快捷方式启动，**无需安装 Python 或任何依赖**

> 安装包内已内置 Python 3.12 解释器 + 全部依赖库（共 57 个包），完全离线可用。  
> 详见 [docs/部署说明.md](docs/部署说明.md)

---

### 开发者环境搭建

#### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.5 | Python 环境与包管理（自动安装 Python 3.12） |
| Node.js | ≥ 20 LTS | 前端构建 |
| Git | 任意 | 版本控制 |

> **无需**手动安装 Python，uv 会自动处理。

#### 1. 克隆仓库

```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio
```

#### 2. 启动后端

```powershell
cd server
uv sync                    # 首次执行：自动下载 Python 3.12 + 所有依赖
uv run python main.py      # 启动 FastAPI，监听 127.0.0.1:18899
```

验证：`http://127.0.0.1:18899/health` 返回 `{"status":"ok"}` 即正常。

#### 3. 启动前端

```powershell
cd client
npm install                # 安装 Node.js 依赖
npm run dev                # 启动 Electron + Vite 开发服务器（热更新）
```

#### 4. 生成测试数据（可选）

```powershell
cd server
uv run python tests/create_fixtures.py
```

---

## 📦 一键构建（生产包）

```powershell
# 全量构建（后端 exe + Electron 安装包）
.\scripts\build-all.ps1

# 仅构建后端（PyInstaller → server/dist/xgboost-server.exe）
.\scripts\build-server.ps1

# 仅构建前端（electron-builder → dist/XGBoost Studio Setup x.x.x.exe）
.\scripts\build-client.ps1
```

产物路径：`dist\XGBoost Studio Setup x.x.x.exe`

---

## 📁 项目结构

```
XGBoostStudio/
├── server/                      # Python FastAPI 后端
│   ├── main.py                  # 应用入口，注册路由，启动 uvicorn @ 18899
│   ├── pyproject.toml           # uv 依赖声明（等同于 package.json）
│   ├── build.spec               # PyInstaller 打包配置
│   ├── db/
│   │   ├── database.py          # SQLAlchemy 引擎 + APPDATA 路径常量
│   │   └── models.py            # ORM 表定义（Dataset、Split、Model、Report 等）
│   ├── routers/                 # API 路由层（仅做参数校验与转发）
│   │   ├── datasets.py          # 数据导入、预览、特征分析、特征工程、数据集划分
│   │   ├── params.py            # 参数 schema、规则推荐
│   │   ├── training.py          # 训练启动、SSE 进度流
│   │   ├── models.py            # 评估、SHAP、学习曲线、模型管理
│   │   ├── tuning.py            # Optuna 调优启动、SSE 进度流
│   │   ├── prediction.py        # 单样本/批量预测
│   │   ├── reports.py           # PDF 报告生成、下载、预览
│   │   └── wizard.py            # 智能向导专属路由（摘要/预处理建议/快速配置/流水线）
│   ├── services/                # 业务逻辑层（路由不含业务，只调 service）
│   │   ├── dataset_service.py
│   │   ├── feature_service.py
│   │   ├── training_service.py
│   │   ├── eval_service.py
│   │   ├── tuning_service.py
│   │   ├── params_service.py
│   │   ├── prediction_service.py
│   │   ├── report_service.py    # reportlab PDF 生成
│   │   └── wizard_service.py    # 向导流水线逻辑
│   ├── schemas/                 # Pydantic 请求/响应模型
│   └── tests/
│       ├── create_fixtures.py   # 生成 8 个测试数据集
│       └── acceptance_test.py   # 验收测试脚本
├── client/                      # Electron + React 前端
│   ├── electron/
│   │   ├── main.ts              # Electron 主进程（窗口管理、菜单）
│   │   ├── server-manager.ts    # Python 子进程生命周期（启动/健康检查/退出）
│   │   └── preload.ts           # contextBridge 暴露 IPC（openExternal 等）
│   ├── src/
│   │   ├── pages/               # 11 个功能页面
│   │   │   ├── SmartWorkflow/   # 智能向导（6 步流水线，三层体验）
│   │   │   ├── DataImport/      # 数据导入与预览
│   │   │   ├── FeatureAnalysis/ # 特征分析
│   │   │   ├── FeatureEngineering/ # 特征工程与划分
│   │   │   ├── ParamConfig/     # 参数配置
│   │   │   ├── ModelTraining/   # 模型训练
│   │   │   ├── ModelEval/       # 模型评估（含 SHAP/学习曲线自动加载）
│   │   │   ├── ModelTuning/     # 超参数调优
│   │   │   ├── ModelManagement/ # 模型管理
│   │   │   ├── Report/          # PDF 报告管理
│   │   │   └── Prediction/      # 交互式预测
│   │   ├── components/
│   │   │   ├── MainLayout.tsx   # 全局布局（顶栏状态标签、侧边栏折叠）
│   │   │   ├── ParamExplainCard.tsx # 参数解释卡片（学习模式）
│   │   │   └── HelpButton.tsx   # 页面级帮助浮层
│   │   ├── api/                 # axios 接口封装（按模块拆分）
│   │   ├── store/
│   │   │   └── appStore.ts      # Zustand 全局状态（activeDatasetId/SplitId/ModelId）
│   │   └── types/               # TypeScript 类型定义
│   └── package.json
├── scripts/
│   ├── build-all.ps1
│   ├── build-server.ps1
│   └── build-client.ps1
├── docs/
│   ├── 部署说明.md
│   └── 迭代计划.md
├── 需求文档.md                   # 产品功能规格（权威来源）
├── 验收标准文档.md               # 可执行验收标准（权威来源）
└── 开发规范.md                   # 分支策略、提交规范、编码约定
```

---

## 🔌 主要 API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/datasets/upload` | 上传数据集（CSV/Excel） |
| `GET` | `/api/datasets/{id}/preview` | 分页预览数据（返回 `{ columns, data, total }`） |
| `GET` | `/api/datasets/{id}/stats` | 列统计信息 |
| `GET` | `/api/datasets/{id}/quality-score` | 数据质量评分（0–100） |
| `POST` | `/api/datasets/{id}/handle-missing` | 缺失值处理 |
| `POST` | `/api/datasets/{id}/handle-outliers` | 异常值处理 |
| `POST` | `/api/datasets/{id}/feature-engineering/encode` | 特征编码 |
| `POST` | `/api/datasets/{id}/feature-engineering/scale` | 特征缩放 |
| `POST` | `/api/datasets/{id}/feature-engineering/pca` | PCA 降维 |
| `POST` | `/api/datasets/{id}/split` | 划分训练/测试集 |
| `GET` | `/api/params/schema` | XGBoost 参数元数据（含范围、默认值、说明） |
| `GET` | `/api/params/recommend` | 基于数据集规则推荐参数 |
| `POST` | `/api/training/start` | 启动训练任务 |
| `GET` | `/api/training/{id}/progress` | **SSE** 实时训练进度流 |
| `GET` | `/api/models/{id}/evaluation` | 评估指标 + 混淆矩阵/ROC/残差数据 |
| `GET` | `/api/models/{id}/shap` | SHAP 特征重要性分析 |
| `GET` | `/api/models/{id}/learning-curve` | 学习曲线数据 |
| `POST` | `/api/tuning/start` | 启动 Optuna 超参数调优 |
| `GET` | `/api/tuning/{id}/progress` | **SSE** 实时调优进度流 |
| `POST` | `/api/prediction/single` | 单样本预测（含 SHAP 贡献） |
| `POST` | `/api/prediction/batch` | 批量文件预测 |
| `POST` | `/api/reports/generate` | 生成 PDF 报告（reportlab） |
| `GET` | `/api/reports/{id}/preview` | 流式返回 PDF 文件（供系统 PDF 阅读器打开） |
| `GET` | `/api/reports/{id}/download` | 下载 PDF 文件 |
| `GET` | `/api/wizard/dataset-summary/{id}` | 向导数据集智能摘要 |
| `GET` | `/api/wizard/preprocess-suggestions/{id}` | AI 预处理建议列表 |
| `POST` | `/api/wizard/quick-config` | 基于数据划分 AI 推荐参数 |
| `POST` | `/api/wizard/run-pipeline` | **SSE** 一键训练→评估→报告流水线 |
| `POST` | `/api/wizard/run-lab` | **SSE** 参数对比实验 |

完整交互文档（Swagger UI）：启动后端后访问 `http://127.0.0.1:18899/docs`

---

## 🧪 测试数据集

| 编号 | 文件 | 行数 | 任务 | 用途 |
|------|------|------|------|------|
| DS-01 | `titanic_train.csv` | 891 | 二分类（Survived） | 分类功能主测试集 |
| DS-02 | `titanic_test.csv` | 418 | — | 批量预测测试 |
| DS-03 | `boston_housing.csv` | 506 | 回归（MEDV） | 回归功能主测试集 |
| DS-04 | `iris.csv` | 150 | 多分类（species） | 多分类测试 |
| DS-05 | `large_100k.csv` | 100,000 | 回归 | 性能压力测试 |
| DS-06 | `missing_heavy.csv` | 500 | 二分类 | 缺失值处理专项（约 30% 缺失） |
| DS-07 | `duplicate_rows.csv` | 200 | — | 含 50 条重复行的去重测试 |

生成命令：

```powershell
cd server
uv run python tests/create_fixtures.py
```

---

## 🔧 核心技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面容器 | Electron | 28.3 |
| 前端框架 | React + TypeScript | 18.3 / 5.7 |
| UI 组件库 | Ant Design | 5.22 |
| 图表 | ECharts (echarts-for-react) | 5.5 / 3.0 |
| 全局状态 | Zustand | 4.5 |
| HTTP 客户端 | axios | 1.7 |
| 前端构建 | Vite + electron-vite | 5.4 / 2.3 |
| 打包 | electron-builder | 25 |
| 后端框架 | FastAPI + uvicorn | 0.135 / 0.42 |
| Python 运行时 | Python (via uv) | 3.12 |
| 机器学习 | XGBoost | 3.2 |
| 可解释 AI | SHAP | 0.51 |
| 超参数搜索 | Optuna | 4.8 |
| 统计分析 | scipy + statsmodels | 1.17 / 0.14 |
| ML 工具 | scikit-learn | 1.8 |
| PDF 生成 | reportlab | 4.0 |
| 数据处理 | pandas | 3.0 |
| ORM | SQLAlchemy | 2.0 |
| 数据库 | SQLite | — |

---

## 📋 开发规范

- **分支策略**：`main` 保持可发布状态，功能开发在 `feat/*` 分支，详见 [开发规范.md](开发规范.md)
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)（`feat/fix/docs/chore`）
- **Python 命令**：统一使用 `uv run python ...`，**禁止**直接调用 `python`
- **后端分层**：`routers/` 只做路由与参数校验；业务逻辑在 `services/`；ORM 在 `db/`
- **前端分层**：页面在 `pages/`；HTTP 调用在 `src/api/`；全局状态在 `store/appStore.ts`
- **端口**：后端固定 `127.0.0.1:18899`，变更时需同时修改 `server-manager.ts` 和前端 `api/client.ts`

---

## 📄 许可证

[MIT License](LICENSE)

---

<p align="center">Built with ❤️ using XGBoost · FastAPI · Electron · React</p>


---

## ✨ 功能亮点

| 模块 | 核心能力 |
|------|----------|
| 📥 **数据导入** | CSV / Excel 拖拽上传，多 Sheet 选择，虚拟滚动预览 |
| 🔍 **特征分析** | 分布检验（Shapiro-Wilk）、Pearson/Spearman 相关热力图、VIF 多重共线性、ANOVA 目标关系 |
| 🛠 **特征工程** | 缺失值处理、异常值截断、Label/One-Hot 编码、StandardScaler/MinMax 缩放、PCA 降维、数据集划分 |
| ⚙️ **参数配置** | 13 个 XGBoost 超参数可视化配置面板，规则推荐引擎，实时合法性校验 |
| 🚀 **模型训练** | SSE 实时进度流，训练/验证曲线 ECharts 渲染，日志滚动 |
| 📊 **模型评估** | 混淆矩阵热力图、ROC 曲线（AUC）、残差散点图、SHAP Top-20 重要性 |
| 🎯 **超参数调优** | Optuna TPE/随机搜索，SSE 流式 Trial 进度，最优参数自动保存模型 |
| 🗂 **模型管理** | 模型注册表，重命名/标签/导出，多模型雷达图对比 |
| 📄 **分析报告** | 自动生成深色主题 HTML 报告，iframe 预览 + 一键下载 |
| 🤖 **交互预测** | 单样本 JSON 输入（含 SHAP 贡献）+ 批量文件预测 + CSV 结果下载 |

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────────────┐
│                  Electron 28 主进程                   │
│  ServerManager (server-manager.ts) 管理 Python 子进程  │
│       IPC ↔ contextBridge ↔ 渲染进程                  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP REST + SSE
┌──────────────────────▼──────────────────────────────┐
│            React 18 + Ant Design 5 前端               │
│  Zustand 状态管理 │ ECharts 5 图表 │ axios HTTP 客户端 │
└──────────────────────────────────────────────────────┘
                       │ 127.0.0.1:18899
┌──────────────────────▼──────────────────────────────┐
│         FastAPI 0.135+ 后端 (Python 3.12)             │
│  路由层: datasets / params / training / models        │
│          tuning / prediction / reports               │
│  服务层: dataset_service / feature_service            │
│          training_service / eval_service             │
│          tuning_service / prediction_service         │
│          params_service / report_service             │
│  数据层: SQLAlchemy 2.0 + SQLite                      │
│          XGBoost 3.2 │ SHAP 0.51 │ Optuna 4.8        │
└──────────────────────────────────────────────────────┘
```

**数据存储路径**（Windows）：`%APPDATA%\XGBoostStudio\`
- `app.db` — SQLite 元数据
- `datasets/` — 上传的数据集 CSV
- `models/` — 训练保存的 `.ubj` 模型文件
- `reports/` — 生成的 HTML 报告

---

## 🚀 快速开始

### 终端用户（零技术门槛）

1. 下载 `XGBoost Studio Setup x.x.x.exe`
2. 双击安装，按提示完成
3. 从桌面快捷方式启动，**无需安装 Python 或其他依赖**

> 详见 [docs/部署说明.md](docs/部署说明.md)

---

### 开发者环境搭建

#### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Python | 3.12 | 通过 `uv` 管理 |
| Node.js | 18+ | 前端构建 |
| uv | 最新 | Python 包管理器 |
| Git | 任意 | 版本控制 |

#### 1. 克隆仓库

```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio
```

#### 2. 启动后端

```powershell
cd server
uv sync                    # 安装所有 Python 依赖
uv run python main.py      # 启动 FastAPI，监听 127.0.0.1:18899
```

验证：访问 http://127.0.0.1:18899/health，返回 `{"status":"ok","version":"0.1.0"}`

#### 3. 启动前端

```powershell
cd client
npm install                # 安装 Node.js 依赖
npm run dev                # 启动 Electron + Vite 开发服务
```

#### 4. 生成测试数据（可选）

```powershell
cd server
uv run python tests/create_fixtures.py
```

生成 8 个测试数据集到 `server/tests/fixtures/`，涵盖分类、回归、缺失值、重复行、多 Sheet 等场景。

---

## 📦 一键构建（生产包）

```powershell
# 构建完整安装包（后端 exe + Electron 安装包）
.\scripts\build-all.ps1

# 仅构建后端
.\scripts\build-server.ps1

# 仅构建前端
.\scripts\build-client.ps1
```

产物：`client\dist\XGBoost Studio Setup x.x.x.exe`

---

## 📁 项目结构

```
XGBoostStudio/
├── server/                    # Python FastAPI 后端
│   ├── main.py                # 应用入口，端口 18899
│   ├── db/
│   │   ├── database.py        # SQLAlchemy 引擎 + 路径常量
│   │   └── models.py          # ORM 表定义
│   ├── routers/               # API 路由层（7 个模块）
│   │   ├── datasets.py        # 模块 1-3：数据 + 特征
│   │   ├── params.py          # 模块 4：参数配置
│   │   ├── training.py        # 模块 5：模型训练 SSE
│   │   ├── models.py          # 模块 6/8：评估 + 管理
│   │   ├── tuning.py          # 模块 7：Optuna 调优 SSE
│   │   ├── reports.py         # 模块 9：报告生成
│   │   └── prediction.py      # 模块 10：预测推断
│   ├── services/              # 业务逻辑层
│   │   ├── dataset_service.py
│   │   ├── feature_service.py
│   │   ├── training_service.py
│   │   ├── eval_service.py
│   │   ├── tuning_service.py
│   │   ├── params_service.py
│   │   ├── prediction_service.py
│   │   └── report_service.py
│   ├── schemas/               # Pydantic 请求/响应模型
│   ├── tests/                 # 测试夹具生成脚本
│   ├── build.spec             # PyInstaller 打包配置
│   └── pyproject.toml         # uv 依赖声明
├── client/                    # Electron + React 前端
│   ├── electron/
│   │   ├── main.ts            # Electron 主进程
│   │   ├── server-manager.ts  # Python 子进程生命周期管理
│   │   └── preload.ts         # contextBridge IPC
│   ├── src/
│   │   ├── pages/             # 10 个功能页面组件
│   │   ├── components/        # MainLayout、LoadingScreen
│   │   ├── api/               # axios 接口封装（8 个模块）
│   │   ├── store/             # Zustand 全局状态
│   │   └── types/             # TypeScript 类型定义
│   └── package.json
├── scripts/                   # 构建脚本
│   ├── build-all.ps1
│   ├── build-server.ps1
│   └── build-client.ps1
└── docs/
    └── 部署说明.md
```

---

## 🔌 主要 API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/datasets/upload` | 上传数据集 |
| `GET` | `/api/datasets/{id}/preview` | 分页预览数据 |
| `GET` | `/api/datasets/{id}/stats` | 列统计信息 |
| `POST` | `/api/datasets/{id}/split` | 划分训练/测试集 |
| `GET` | `/api/params/schema` | XGBoost 参数元数据 |
| `GET` | `/api/params/recommend` | 规则推荐参数 |
| `POST` | `/api/training/start` | 启动训练任务 |
| `GET` | `/api/training/{id}/progress` | SSE 训练进度流 |
| `GET` | `/api/models/{id}/evaluation` | 评估指标 + 图表数据 |
| `GET` | `/api/models/{id}/shap` | SHAP 详细分析 |
| `POST` | `/api/tuning/start` | 启动 Optuna 调优 |
| `GET` | `/api/tuning/{id}/progress` | SSE 调优进度流 |
| `POST` | `/api/prediction/single` | 单样本预测 |
| `POST` | `/api/prediction/batch` | 批量预测（文件上传）|
| `POST` | `/api/reports/generate` | 生成 HTML 报告 |

完整文档：启动后端后访问 http://127.0.0.1:18899/docs

---

## 🧪 测试数据集

| 编号 | 文件 | 行数 | 任务 | 用途 |
|------|------|------|------|------|
| DS-01 | `titanic_train.csv` | 891 | 二分类 | 分类主测试集 |
| DS-02 | `titanic_test.csv` | 418 | — | 批量预测测试 |
| DS-03 | `boston_housing.csv` | 506 | 回归 | 回归主测试集 |
| DS-04 | `iris.csv` | 150 | 多分类 | 多分类测试 |
| DS-05 | `large_100k.csv` | 100,000 | 回归 | 性能压力测试 |
| DS-06 | `missing_heavy.csv` | 500 | 二分类 | 缺失值处理（~30%缺失）|
| DS-07 | `multisheet.xlsx` | — | — | 多 Sheet 导入测试 |
| DS-08 | `duplicate_rows.csv` | 200 | — | 含 50 条重复行 |

生成命令：`cd server && uv run python tests/create_fixtures.py`

---

## 📋 开发规范

- **分支策略**：`main` 保持可发布状态，功能开发在 `feat/*` 分支
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- **Python**：`uv run` 执行所有命令，禁止直接调用 `python`
- **端口**：后端固定 `127.0.0.1:18899`，仅本地访问
- **代码风格**：Python 使用 ruff，TypeScript 使用 ESLint + Prettier

详见 [开发规范.md](开发规范.md)

---

## 📄 许可证

[MIT License](LICENSE)

---

<p align="center">Built with ❤️ using XGBoost · FastAPI · Electron · React</p>
