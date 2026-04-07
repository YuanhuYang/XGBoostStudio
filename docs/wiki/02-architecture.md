# XGBoost Studio · 技术架构

> **版本对应**：v0.5.0  
> **最后更新**：2026-04-07（v0.5.x：四模式导航、顶栏划分/主模型/专家对比、应用内文档中心；`client`/`server` 版本号对齐）

---

## 一、技术栈总览

### 整体架构：本地 C/S + Electron 封装

```
┌─────────────────────────────────────────────────────────────────────┐
│                         桌面应用（Electron 28）                       │
│                                                                     │
│  ┌─────────────────────────────────────┐  ┌────────────────────┐   │
│  │     渲染进程（Renderer Process）       │  │  主进程（Main）     │   │
│  │                                     │  │                    │   │
│  │  React 18 + TypeScript              │  │  electron-vite     │   │
│  │  Ant Design 5（UI 组件库）            │  │  server-manager    │   │
│  │  ECharts（图表）                      │  │  （管理后端进程）    │   │
│  │  Zustand（全局状态）                   │  │                    │   │
│  │  Axios（HTTP 客户端）                 │  └────────────────────┘   │
│  │  react-pdf（PDF 预览）                │                           │
│  └──────────────┬──────────────────────┘                           │
│                 │ HTTP REST + SSE（127.0.0.1:18899）                │
│  ┌──────────────▼──────────────────────┐                           │
│  │    API 服务进程（FastAPI + Uvicorn）  │                           │
│  │                                     │                           │
│  │  XGBoost 3.x（建模引擎）              │                           │
│  │  Optuna 4.x（超参数搜索）             │                           │
│  │  SHAP 0.5x（可解释性）               │                           │
│  │  Pandas / NumPy / Scipy             │                           │
│  │  Scikit-learn（基线/校准/学习曲线）    │                           │
│  │  Statsmodels（VIF/ANOVA/分布检验）    │                           │
│  │  ReportLab（PDF 生成）               │                           │
│  │  SQLite（元数据存储）                 │                           │
│  └─────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 进程模型说明

1. **Electron 主进程**（`client/electron/main.ts`）：负责窗口生命周期、本地文件系统访问、打包后的后端服务进程管理（`server-manager.ts`）。

2. **渲染进程**（`client/src/`）：纯前端 SPA，通过 `http://127.0.0.1:18899` 与后端通信。Electron `preload.ts` 提供安全的 IPC bridge。

3. **FastAPI 服务进程**（`server/`）：以子进程方式被主进程拉起（打包后 Windows 为 `xgboost-server.exe`，macOS/Linux 为同名无扩展名二进制，均经 PyInstaller），**独立进程，随应用启动/退出**。

---

## 二、前端模块结构

```
client/src/
├── pages/                   # 路由页（MainLayout.pageMap 的 PageKey → 组件）
│   ├── Welcome/             # 欢迎页
│   ├── Documentation/       # 文档中心（v0.5；react-markdown + MermaidBlock）
│   ├── ExpertWorkbench/     # 专家分析 · 模型工作台（pageKey: expert-hub）
│   ├── LearningWorkbench/   # 模型调优 · 调优工作台（pageKey: learning-hub）
│   ├── SmartWorkflow/       # 智能向导 · 向导工作台（pageKey: smart-workflow；6 步）
│   ├── DataImport/          # 数据工作台（pageKey: data-import）
│   ├── FeatureAnalysis/     # 特征分析（教学 UI：showTeachingUi）
│   ├── FeatureEngineering/  # 特征工程
│   ├── ParamConfig/         # 参数配置（LearningPanel + ParamLabModal）
│   ├── ModelTraining/       # 模型训练（收敛解释卡 + isTraining）
│   ├── ModelEval/           # 模型评估（指标 Tooltip 等）
│   ├── ModelTuning/         # 超参数调优（5 阶段 + 最优点 markPoint）
│   ├── ModelManagement/     # 模型管理（AUC/KS 差值列等）
│   ├── Report/              # 分析报告（12 章 PDF）
│   └── Prediction/          # 交互式预测
├── store/
│   └── appStore.ts          # Zustand：activeDatasetId / activeSplitId / activeModelId
│                            #   workflowMode: guided | preprocess | learning | expert
│                            #   workflowStep / sidebarCollapsed / modeFirstVisit / isTraining …
│                            #   持久化：workflowMode、侧栏、向导步骤、活跃 ID → localStorage
├── api/                     # 后端 API 调用封装
│   ├── client.ts            # Axios（baseURL: 127.0.0.1:18899）
│   ├── datasets.ts
│   ├── training.ts
│   ├── models.ts
│   ├── tuning.ts
│   ├── reports.ts
│   ├── wizard.ts            # 向导 Pipeline + Lab 实验
│   ├── automl.ts            # AutoML：POST 作业、SSE 进度（EventSource）
│   └── ...
├── docs/
│   └── docSources.ts        # import.meta.glob 打入 docs/wiki、docs/guides、根 README 原文
├── utils/
│   └── teachingUi.ts        # showTeachingUi：guided | preprocess | learning → true；expert → false
├── components/
│   ├── MainLayout.tsx       # 四态侧栏 + ModeSwitcher + 顶栏划分/主模型/专家对比 + Ctrl+K
│   ├── ModeSwitcher.tsx     # Segmented：智能向导 / 数据处理 / 模型调优 / 专家分析
│   ├── LearningPanel.tsx
│   ├── ParamLabModal.tsx
│   ├── ModeTransitionModal.tsx
│   ├── ModeOnboardingModal.tsx
│   ├── ParamExplainCard.tsx
│   ├── HelpButton.tsx
│   └── ...
└── constants/
    ├── docsManifest.ts      # DOCS_MANIFEST：应用内文档目录 id / 分组 / fileBase
    └── reportSections.ts    # 12 章定义 + 4 种模板（向后兼容）
```

### 应用内文档中心（v0.5）

- **页面**：`client/src/pages/Documentation/index.tsx`，默认打开文档 id `wiki-01-product-overview`（与代码内 `DEFAULT_DOC_ID` 一致）。
- **目录**：`constants/docsManifest.ts` 中 `DOCS_MANIFEST`，分组 `project`（根 README）/ `wiki`（`01`–`09`）/ `guides`（精选 `docs/guides/*.md`）。
- **正文加载**：`docSources.ts` 使用 `import.meta.glob('../../../docs/wiki/*.md')` 等构建期注入；**未**列入 manifest 的 Markdown（例如 [`10-windows-distribution.md`](10-windows-distribution.md)）不会出现在应用内左侧目录，但仍可在仓库或 GitHub 阅读。
- **互链**：文内相对 `.md` 链接经 `findDocByFileBase` 解析后在应用内切换篇目；Mermaid 由 `MermaidBlock` 渲染。

### 全局状态流（Zustand appStore）

```
activeDatasetId ──► DataImport / FeatureAnalysis / FeatureEngineering
activeSplitId   ──► ModelTraining / ModelTuning / Prediction / 顶栏模型列表过滤
activeModelId   ──► ModelEval / ModelTuning / Report / Prediction

workflowMode ──────► MainLayout（侧栏菜单项 + 部分页面可达性）
              ├──► guided    → 侧栏仅「向导工作台」；点击其它侧栏项 → 暂离向导确认
              ├──► preprocess→ 侧栏仅数据工作台 / 特征分析 / 特征工程；离开三页 → 离开数据处理确认
              ├──► learning  → 侧栏「调优工作台」+ 参数配置 / 训练 / 超参调优 / 管理；进入前须 activeDatasetId
              └──► expert    → 侧栏「模型工作台」+ 评估 / 管理 / 报告 / 预测（无训练、超参、数据处理、向导）

顶栏（各模式均展示）──► 训练划分 Select、主模型 Select
专家模式额外 ─────────► 对比模型多选 Select（依赖已选划分与主模型）

showTeachingUi(workflowMode) ──► guided | preprocess | learning → true；expert → false
```

三个 ID 跨页面自动传递。**跨模式不清零**；向导步骤与活跃 ID 从 localStorage 恢复时写回 store。

### 四模式侧栏与命令面板（与实现对齐）

| `workflowMode` | 侧栏菜单（摘要） | Ctrl+K 可搜索页面（摘要） |
|----------------|------------------|---------------------------|
| `guided` | 向导工作台 | 含全部功能页 + 文档 + 各工作台 |
| `preprocess` | 数据工作台、特征分析、特征工程 | 仅上述三数据页 + 文档 |
| `learning` | 调优工作台 + 参数配置 / 训练 / 调优 / 管理 | 同 guided（全量可搜） |
| `expert` | 模型工作台 + 评估 / 管理 / 报告 / 预测 | **排除**数据处理、向导、调优工作台、参数配置、训练、调优 |

持久化恢复默认页：`expert` → `expert-hub`，`learning` → `learning-hub`，`preprocess` → `data-import`，其余 → `smart-workflow`。

---

## 三、后端模块结构

```
server/
├── main.py              # FastAPI 应用入口，注册全部 Router
├── cli/                 # xs-studio：交互 REPL + run 子命令；子进程 uvicorn + httpx 调本服务 API（AutoML/数据集/报告）
├── routers/             # HTTP 路由层
│   ├── datasets.py      # 数据集 + 特征分析（含 G3-A 新增路由）
│   ├── training.py      # 训练 + K折
│   ├── models.py        # 模型评估（含 G3-B PDP/OOT/鲁棒性/公平性）
│   ├── tuning.py        # 超参数调优（SSE 流式进度）
│   ├── reports.py       # PDF 报告生成（含 G3-C 12章/模板/品牌）
│   ├── prediction.py    # 预测（批量 + 单次）
│   ├── params.py        # 参数推荐/验证
│   ├── wizard.py        # 智能向导 Pipeline（SSE 一键训练+报告）
│   └── automl.py        # 全自动建模任务：POST 启动作业、GET SSE 进度、GET 结果
├── services/            # 业务逻辑层
│   ├── feature_service.py      # 分布/相关/VIF/PCA + G3-A: IV/KS/PSI/单调性/标签
│   ├── leakage_service.py      # G3-A: 三类泄露检测（时间穿越/标签/拟合）
│   ├── dataset_service.py      # 数据集 CRUD、预处理、划分
│   ├── dataset_narrative_service.py  # 数据叙事（G2-R1）
│   ├── training_service.py     # XGBoost 训练执行（含 train_and_persist_sync 供编排同步落库）
│   ├── eval_service.py         # 评估 + G3-B: PDP/OOT/鲁棒性/坏样本/公平性
│   ├── tuning_service.py       # G3-B 重构: 5阶段分层调优（Optuna）+ run_lite_tuning_best_params（AutoML 预算内联合搜索）
│   ├── report_service.py       # G3-C 重构: 12章 PDF（ReportLab）
│   ├── chart_service.py        # 图表生成（Matplotlib → bytes）
│   ├── prediction_service.py   # 预测 + SHAP 单样本
│   ├── provenance.py           # 模型运行档案（G2-Auth-1）
│   ├── wizard_service.py       # 向导 Pipeline 编排
│   └── automl_service.py       # 全自动建模编排（目标推断、划分、多候选训练、排序）
├── db/
│   ├── database.py      # SQLAlchemy 引擎 + Session 工厂
│   └── models.py        # ORM 数据模型
├── schemas/
│   ├── model.py         # Pydantic 请求/响应模型（含 BrandConfig, template_type）
│   ├── dataset.py
│   └── narrative.py
└── tests/               # pytest 测试套件
```

---

## 四、数据存储

### SQLite 数据库（`server/data/xgboost_studio.db`）

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `datasets` | id, name, path, target_column | 数据集元数据 |
| `dataset_splits` | id, dataset_id, train_path, test_path, split_strategy | 训练/测试划分（含时间序列划分） |
| `models` | id, name, task_type, params_json, metrics_json, provenance_json, cv_* | 模型注册表 |
| `training_tasks` | id, split_id, status, error_msg | 训练任务状态 |
| `tuning_tasks` | id, split_id, strategy, best_params_json, tuning_diagnostics_json | 调优任务（含5阶段phase_records） |
| `reports` | id, model_id, path, report_type | PDF 报告记录 |
| `report_templates` | id, name, sections, is_builtin | 用户自定义报告模板 |

### 文件系统（`server/data/`）

```
server/data/
├── uploads/     # 用户上传的原始数据集（CSV/XLSX）
├── processed/   # 经特征工程处理后的中间数据集
├── splits/      # 数据集划分结果（train.csv / test.csv）
├── models/      # XGBoost 模型文件（.ubj 格式）
└── reports/     # 生成的 PDF 报告文件
```

---

## 五、API 通信规范

### REST 接口

- 基础路径：`http://127.0.0.1:18899`
- 认证：无（纯本地，无网络暴露风险）
- 格式：`application/json`
- 错误码：遵循 HTTP 语义（400 参数错误 / 404 资源不存在 / 422 校验失败 / 500 内部错误）

### SSE（Server-Sent Events）

用于训练进度和调优进度的实时推送，前端用 `EventSource` 接收：

```typescript
// 训练进度
GET /api/training/{task_id}/progress → SSE 流

// 调优进度（5阶段，每个 trial + phase_start/phase_end 事件）
GET /api/tuning/{task_id}/progress → SSE 流

// 全自动建模（内存任务，进程重启丢失）
POST /api/automl/jobs → { job_id }，请求体含 dataset_id、可选 target_column、train_ratio、max_tuning_trials、skip_tuning 等
GET  /api/automl/jobs/{job_id}/progress → SSE，`data:` 行为 JSON 步骤事件，末尾 `event: done`
GET  /api/automl/jobs/{job_id}/result → 任务完成后返回 candidates、chosen_recommendation、warnings 等
```

**命令行编排**：`server/cli/` 中 `StudioHttpClient` 调用上述 AutoML 路径（及数据集上传、报告生成等），与 UI 共用同一后端进程与数据库；说明见 [`08-automl-wizard.md`](08-automl-wizard.md) §2.2、[xs-studio CLI 指南](../guides/xs-studio-cli.md)。

SSE 事件字段说明见 [`04-model-training.md`](04-model-training.md) 和 [`05-auto-tuning.md`](05-auto-tuning.md)。**AutoML** 步骤语义与约束见 [`08-automl-wizard.md`](08-automl-wizard.md)。

---

## 六、打包与分发

- **客户端打包**：`electron-vite build + electron-builder`；Windows 输出 **NSIS** 与 **portable**（[`10-windows-distribution.md`](10-windows-distribution.md)）；macOS **dmg/zip**、Linux **AppImage/deb**（[`11-mac-linux-distribution.md`](11-mac-linux-distribution.md)）
- **服务端打包**：`PyInstaller` onefile；Windows 为 `xgboost-server.exe`，Unix 为 `xgboost-server`，按平台写入 Electron `extraResources`
- **版本对齐**：`client/package.json` 和 `server/pyproject.toml` 中的 `version` 字段须保持一致

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.5.x | **四模式** `preprocess`；专家侧栏收窄；顶栏 **训练划分 / 主模型** + 专家 **对比模型**；`showTeachingUi` 含 `preprocess`；与 [`01-product-overview.md`](01-product-overview.md) 同步 |
| v0.5.0 | 应用内 **文档中心**（`client/src/pages/Documentation` + `docsManifest` + `docSources` glob）；`client/package.json` 与 `server/pyproject.toml` 版本统一为 **0.5.0** |
| v0.4.0 | I6-ThreeModeUX：三模式交互架构；`MainLayout` 三态侧栏；专家 Ctrl+K；教学组件落地 |
| v0.4.x | 顶栏曾按模式突出单上下文（Tag）；调优侧栏收窄；UI「学习」→「模型调优」；`teachingUi.ts` 向导与调优默认教学、专家关闭（v0.5 顶栏已改为划分/主模型下拉 + 专家对比） |
| v0.4+ AutoML | 新增 `routers/automl.py`、`services/automl_service.py`；`training_service.train_and_persist_sync`；`tuning_service.run_lite_tuning_best_params`；`SmartWorkflow` Step 0 全自动建模 UI；**`server/cli/` xs-studio**；Wiki [`08-automl-wizard.md`](08-automl-wizard.md) |
| v0.3.0 | G3-A：新增 leakage_service.py + feature_service 扩展；G3-B：tuning_service 重构为5阶段 + eval_service 扩展 PDP/ICE/OOT/鲁棒性；G3-C：report_service 重构为12章 + BrandConfig schema |
| v0.2.0 | 模型运行档案（provenance）、K折协议、数据叙事（G2-R1）落地 |
| v0.1.0 | 基础 C/S 架构搭建，六轮迭代核心功能落地 |
