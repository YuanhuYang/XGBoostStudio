# XGBoost Studio · 技术架构

> **版本对应**：v0.4.0
> **最后更新**：2026-04-06（补充 AutoML 命令行 `server/cli`、同步训练 API）

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

3. **FastAPI 服务进程**（`server/`）：以子进程方式被主进程拉起（打包后为 `xgboost-server.exe` via PyInstaller），**独立进程，随应用启动/退出**。

---

## 二、前端模块结构

```
client/src/
├── pages/           # 十页功能模块（每页一个目录，index.tsx 主入口）
│   ├── Welcome/
│   ├── SmartWorkflow/       # 智能向导（6 步；响应 workflowMode + showTeachingUi）
│   ├── DataImport/          # 数据导入
│   ├── FeatureAnalysis/     # 特征分析（IV/KS/PSI/泄露检测 + 概念卡片，guided/learning 显示）
│   ├── FeatureEngineering/  # 特征工程
│   ├── ParamConfig/         # 参数配置（LearningPanel + ParamLabModal，guided/learning）
│   ├── ModelTraining/       # 模型训练（收敛解释卡 guided/learning + isTraining）
│   ├── ModelEval/           # 模型评估（PDP/ICE/… + 指标 Tooltip guided/learning）
│   ├── ModelTuning/         # 超参数调优（5阶段 + 最优点 markPoint）
│   ├── ModelManagement/     # 模型管理（专家模式 AUC/KS 差值列）
│   ├── Report/              # 分析报告（12章 PDF）
│   └── Prediction/          # 交互式预测
├── store/
│   └── appStore.ts          # Zustand 全局状态（v0.4 扩展）
│                            #   核心 ID：activeDatasetId / activeSplitId / activeModelId
│                            #   交互状态：workflowMode / workflowStep / sidebarCollapsed
│                            #   v0.4 新增：previousMode / modeFirstVisit / isTraining
│                            #   持久化：workflowMode + sidebarCollapsed → localStorage
├── api/                     # 后端 API 调用封装
│   ├── client.ts            # Axios 实例（baseURL: 127.0.0.1:18899）
│   ├── datasets.ts
│   ├── training.ts
│   ├── models.ts
│   ├── tuning.ts
│   ├── reports.ts
│   ├── wizard.ts            # 向导 Pipeline + Lab 实验
│   ├── automl.ts            # 全自动建模：启动作业、拉取结果（SSE 使用 BASE_URL + EventSource）
│   └── ...
├── utils/
│   └── teachingUi.ts        # showTeachingUi：guided/learning 启用教学 UI，expert 关闭
├── components/              # 共享组件
│   ├── MainLayout.tsx       # 三态侧边栏 + 模式切换器 + 顶栏单上下文 Tag + Ctrl+K（专家）
│   ├── ModeSwitcher.tsx     # Segmented：向导 / 调优 / 专家
│   ├── LearningPanel.tsx    # 参数教学卡片（算法直觉/风险条/效果箭头）
│   ├── ParamLabModal.tsx    # 参数对比实验 Modal
│   ├── ModeTransitionModal.tsx  # 训练中切换模式确认弹窗
│   ├── ModeOnboardingModal.tsx  # 模式首次进入新手引导弹窗
│   ├── ParamExplainCard.tsx # 参数卡片（showTeachingUi 时内嵌 LearningPanel）
│   ├── HelpButton.tsx
│   └── ...
└── constants/
    └── reportSections.ts    # 12章定义 + 4种模板 + 旧版章节（向后兼容）
```

### 全局状态流（Zustand appStore）

```
activeDatasetId ──► FeatureAnalysis / FeatureEngineering / DataImport
activeSplitId   ──► ModelTraining / ModelTuning / Prediction
activeModelId   ──► ModelEval / ModelTuning / Report / Prediction

workflowMode ──────► MainLayout（侧边栏 + 顶栏上下文 Tag）
              ├──► guided   → 极简侧边栏；顶栏仅数据集 Tag
              ├──► learning → 侧栏仅 训练/调优/管理；顶栏仅划分 Tag；进入前须 activeDatasetId
              └──► expert   → 完整 10 模块；顶栏仅主模型 Tag；Ctrl+K

showTeachingUi(workflowMode) ──► ParamExplainCard / SmartWorkflow / ParamConfig / FeatureAnalysis / ModelTraining / ModelEval
              ├──► guided | learning → true（教学卡片、参数实验、概念按钮、收敛卡、指标 Tooltip）
              └──► expert → false
```

三个 ID 跨页面自动传递，切换到任何模块时均预填当前活跃 ID，无需手动输入。**v0.4 增强**：三个 ID 在模式切换时严格不清零（注释标记为「跨模式共享状态」），向导会话从 localStorage 恢复时同步更新全局 ID。

### 三模式侧边栏状态机（v0.4，v0.4.x 收窄调优侧栏）

```
guided  ─── 进入 ──► 自动折叠至 56px，仅显示「智能向导」
         └─ 点击非向导项 ──► 拦截确认弹窗（已保存进度）

learning ─── 进入 ──► 宽 220px，仅「模型训练 / 超参数调优 / 模型管理」+「已学」角标
          └─ 无智能向导侧栏项（划分经顶栏 Tag 去特征工程）

expert ─── 进入 ──► 自动展开至 220px，全 10 模块
        └─ 点击「智能向导」 ──► setWorkflowMode('guided')
```

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

- **客户端打包**：`electron-vite build + electron-builder`，输出 NSIS 安装包（Windows）
- **服务端打包**：`PyInstaller`，输出 `xgboost-server.exe`，内嵌在 Electron `extraResources` 中
- **版本对齐**：`client/package.json` 和 `server/pyproject.toml` 中的 `version` 字段须保持一致

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.4.0 | I6-ThreeModeUX：三模式交互架构；`MainLayout` 三态侧栏；专家 Ctrl+K；教学组件落地 |
| v0.4.x | 顶栏单 Tag；调优侧栏收窄；UI「学习」→「调优」；`teachingUi.ts` 向导默认教学、专家关闭 |
| v0.4+ AutoML | 新增 `routers/automl.py`、`services/automl_service.py`；`training_service.train_and_persist_sync`；`tuning_service.run_lite_tuning_best_params`；`SmartWorkflow` Step 0 全自动建模 UI；**`server/cli/` xs-studio**；Wiki [`08-automl-wizard.md`](08-automl-wizard.md) |
| v0.3.0 | G3-A：新增 leakage_service.py + feature_service 扩展；G3-B：tuning_service 重构为5阶段 + eval_service 扩展 PDP/ICE/OOT/鲁棒性；G3-C：report_service 重构为12章 + BrandConfig schema |
| v0.2.0 | 模型运行档案（provenance）、K折协议、数据叙事（G2-R1）落地 |
| v0.1.0 | 基础 C/S 架构搭建，六轮迭代核心功能落地 |
