# XGBoost Studio — AI 一键生成总指令

> **使用方式**：新建 AI 对话时，将本文件全文粘贴作为第一条消息，AI 即可无需人工干预地连续生成完整可执行应用。

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

## 3. 已完成的工作（勿重复）

- [x] `server/pyproject.toml`：Python 依赖已声明，13 个直接依赖
- [x] `server/uv.lock`：57 个包已锁定
- [x] `server/.python-version`：Python 3.12
- [x] `server/.venv/`：虚拟环境已创建，所有包已安装（`uv sync` 无需重跑）
- [x] `.gitignore`：已配置，正确排除 `.venv/`、`node_modules/`、`build/`、`dist/`
- [x] `需求文档.md`：v2.1，10 个功能模块完整规格
- [x] `验收标准文档.md`：v1.0，89 条可执行验收用例
- [x] `开发规范.md`：v1.0，11 章节

---

## 4. 目录结构规范

```
XGBoostStudio/
├── 需求文档.md
├── 验收标准文档.md
├── 开发规范.md
├── AGENT_PROMPT.md               ← 本文件
├── README.md
├── .gitignore
├── docs/
│   └── 部署说明.md
│
├── client/                       # Electron + React 前端（待创建）
│   ├── electron/
│   │   ├── main.ts               # 主进程：窗口 + Python进程生命周期
│   │   ├── preload.ts
│   │   └── server-manager.ts    # 启动/停止 xgboost-server.exe
│   ├── src/
│   │   ├── api/                  # axios 封装，每模块一个文件
│   │   ├── components/           # 通用组件
│   │   ├── pages/                # 页面，一模块一目录
│   │   │   ├── DataImport/
│   │   │   ├── FeatureAnalysis/
│   │   │   ├── FeatureEngineering/
│   │   │   ├── ParamConfig/
│   │   │   ├── ModelTraining/
│   │   │   ├── ModelEval/
│   │   │   ├── ModelTuning/
│   │   │   ├── ModelManagement/
│   │   │   ├── Report/
│   │   │   └── Prediction/
│   │   ├── store/
│   │   ├── types/
│   │   └── utils/
│   ├── resources/                # 打包时放 xgboost-server.exe
│   ├── package.json
│   ├── tsconfig.json
│   └── electron.vite.config.ts
│
├── server/                       # Python FastAPI 后端（已初始化）
│   ├── main.py                   # ⚠️ 当前是空壳，需替换为真实 FastAPI 入口
│   ├── routers/                  # 路由层（待创建）
│   ├── services/                 # 业务层（待创建）
│   ├── schemas/                  # Pydantic 模型（待创建）
│   ├── xgb_engine/               # 已有引擎代码（见 xgboost-studio-windows/python/）
│   ├── db/                       # SQLite ORM（待创建）
│   ├── pyproject.toml            # ✅ 已有
│   ├── uv.lock                   # ✅ 已有
│   ├── .python-version           # ✅ 已有（3.12）
│   └── build.spec                # PyInstaller 配置（待创建）
│
└── scripts/
    ├── build-all.ps1             # 一键构建（待创建）
    ├── build-server.ps1
    └── build-client.ps1
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

## 6. 开发顺序（严格按此顺序，不可跳跃）

### 阶段 0：基础设施（当前阶段）

**目标**：完成脚手架，能启动但功能为空壳，能一键打包出安装包（即使功能为空）。

**任务清单**：

- [ ] **0-1** 替换 `server/main.py` 为真实 FastAPI 入口
  - 启动在 `127.0.0.1:18899`
  - 挂载所有路由（初始空路由）
  - 提供 `GET /health` → `{"status": "ok", "version": "0.1.0"}`
  - 优雅关闭（捕获 SIGTERM）

- [ ] **0-2** 创建 `server/db/database.py` + `server/db/models.py`
  - SQLite，文件路径：`%APPDATA%\XGBoostStudio\app.db`
  - 初始表：`datasets`（id, name, path, created_at）、`models`（id, name, path, task_type, metrics_json, created_at）

- [ ] **0-3** 创建 `server/build.spec`（PyInstaller 配置）
  - 输出单文件 `xgboost-server.exe`
  - 包含所有依赖，包括 xgboost、shap 等的数据文件

- [ ] **0-4** 初始化 `client/` 目录（electron-vite 模板）
  - `npm create electron-vite@latest client -- --template react-ts`
  - 安装：`antd`、`echarts`、`zustand`、`axios`
  - 配置 `electron/main.ts`：启动和停止 `resources/xgboost-server.exe`
  - 配置 `electron/server-manager.ts`：等待 `/health` 返回 200 后再显示窗口
  - 首页显示"正在连接后端服务..."loading，连接成功后显示主界面骨架

- [ ] **0-5** 创建 `scripts/build-all.ps1`
  - 步骤1：`cd server && uv run pyinstaller build.spec`
  - 步骤2：`cp server/dist/xgboost-server.exe client/resources/`
  - 步骤3：`cd client && npm run build`
  - 包含错误处理，任一步骤失败立即退出并提示

- [ ] **0-6** 阶段 0 验证
  - `cd server && uv run python main.py` 能在 18899 端口启动
  - `curl http://127.0.0.1:18899/health` 返回 `{"status": "ok"}`
  - `cd client && npm run dev` 能打开 Electron 窗口
  - `.\scripts\build-all.ps1` 能生成 `.exe` 安装包

- [ ] **0-7** git commit
  ```
  chore(global): 完成阶段0脚手架 - FastAPI服务+Electron窗口+一键构建脚本
  ```

---

### 阶段 1：数据链路（模块 1-3）

**完成阶段 0 后自动开始**。

详细验收标准见 `验收标准文档.md` 对应章节。

#### 模块 1：数据导入与预览（AC-1-01 ~ AC-1-10）

后端：
- `POST /api/datasets/upload`：接收文件（CSV/XLSX），保存到 `%APPDATA%\XGBoostStudio\data\`，返回 dataset_id
- `GET /api/datasets/{id}/preview`：分页返回数据预览（page, page_size）
- `GET /api/datasets/{id}/stats`：每列的类型、非空数、缺失率、均值/中位数/标准差/最大/最小/唯一值数
- `GET /api/datasets/{id}/distribution/{column}`：返回指定列的分布数据（直方图 bins 或条形图频次）
- `GET /api/datasets/{id}/missing-pattern`：缺失值热力图数据（行×列矩阵）
- `POST /api/datasets/{id}/handle-missing`：处理缺失值（均值/中位数/众数/常量/删除行/不处理），支持按列配置
- `GET /api/datasets/{id}/outliers`：3σ + IQR 检测异常值，返回行索引和列名
- `POST /api/datasets/{id}/handle-outliers`：删除或保留异常值
- `GET /api/datasets/{id}/duplicates`：返回重复行数量和明细
- `POST /api/datasets/{id}/drop-duplicates`：删除重复行
- `GET /api/datasets/{id}/quality-score`：综合数据质量评分 0-100

前端：
- 拖拽/点击上传区域
- 多 Sheet 选择下拉（Excel 文件）
- 虚拟滚动数据表格（100k 行流畅）
- 顶部摘要统计卡片
- 点击列名弹出分布图（ECharts）
- 缺失值热力图面板
- 异常值高亮行
- 数据质量评分卡片
- 一键"应用预处理"按钮（应用所有已配置的处理操作）

提交：`feat(data-import): 完成模块1数据导入与预览 [AC-1-01~AC-1-10]`

---

#### 模块 2：特征分析（AC-2-01 ~ AC-2-11）

后端：
- `GET /api/datasets/{id}/feature-analysis/distribution`：所有数值列的分布统计（偏度、峰度、正态性检验 p 值）
- `GET /api/datasets/{id}/feature-analysis/correlation`：Pearson/Spearman/Kendall 相关矩阵
- `GET /api/datasets/{id}/feature-analysis/target-relation`：各特征与目标变量的关系（数值→散点+趋势线，分类→箱线图）
- `GET /api/datasets/{id}/feature-analysis/vif`：VIF 多重共线性检验
- `GET /api/datasets/{id}/feature-analysis/anova`：分类特征的 ANOVA/卡方检验
- `GET /api/datasets/{id}/feature-analysis/importance-preliminary`：基于互信息的初步特征重要性
- `GET /api/datasets/{id}/feature-analysis/multivariate-outliers`：Mahalanobis 距离多元异常值

前端：
- 分布可视化面板（ECharts，支持切换直方图/KDE/Q-Q图）
- 相关矩阵热力图（ECharts heatmap，支持切换相关系数类型）
- 特征-目标关系矩阵图
- VIF 表格（高亮 VIF > 10 的特征）
- 特征重要性初步排行条形图

提交：`feat(feature-analysis): 完成模块2特征分析 [AC-2-01~AC-2-11]`

---

#### 模块 3：特征工程与选择（AC-3-01 ~ AC-3-05）

后端：
- `POST /api/datasets/{id}/feature-engineering/encode`：类别特征编码（One-Hot/Label/Target）
- `POST /api/datasets/{id}/feature-engineering/scale`：数值特征缩放（StandardScaler/MinMaxScaler/RobustScaler）
- `POST /api/datasets/{id}/feature-engineering/box-cox`：Box-Cox 变换（自动寻找最优 λ）
- `POST /api/datasets/{id}/feature-engineering/pca`：PCA 降维
- `POST /api/datasets/{id}/feature-engineering/select`：特征选择（方差筛选/相关系数筛选/递归消除/L1 正则）
- `POST /api/datasets/{id}/split`：划分训练集/测试集（比例、随机种子、分层抽样），返回 split_id

前端：
- 特征工程操作面板（每步操作有预览）
- 特征选择结果对比（选前/选后特征数，保留特征列表）
- 数据集划分配置（滑块设置比例，实时显示训练/测试集样本数）
- "保存工程化数据集"按钮

提交：`feat(feature-engineering): 完成模块3特征工程 [AC-3-01~AC-3-05]`

---

### 阶段 2：建模链路（模块 4-6）

**完成阶段 1 后自动开始**。

#### 模块 4：参数配置（AC-4-01 ~ AC-4-04）

后端：
- `GET /api/params/schema`：返回 XGBoost 所有参数的元数据（类型、范围、默认值、说明）
- `GET /api/params/recommend`：基于数据集特征自动推荐参数（规则引擎 + 经验公式）
- `POST /api/params/validate`：验证参数组合是否合法

前端：
- 参数分组展示（训练参数/树参数/正则化参数/学习参数）
- 每个参数有 tooltip 说明（中文）
- "智能推荐"按钮 → 调用推荐 API 自动填充
- 参数对比模式（并排展示两套参数差异）
- "保存参数配置"，支持命名保存多套配置

提交：`feat(param-config): 完成模块4参数配置 [AC-4-01~AC-4-04]`

---

#### 模块 5：模型训练（AC-5-01 ~ AC-5-05）

后端：
- `POST /api/training/start`：启动训练任务，返回 task_id
- `GET /api/training/{task_id}/progress`：**SSE 端点**，实时推送：
  ```json
  {"round": 10, "total": 100, "train_logloss": 0.35, "val_logloss": 0.41, "elapsed_s": 2.3}
  ```
- `POST /api/training/{task_id}/stop`：停止训练
- `GET /api/training/{task_id}/result`：训练结果（最终指标、模型路径）

前端：
- 训练配置面板（选择数据集 split、参数配置）
- 实时训练进度：进度条 + ECharts 折线图（训练/验证 loss 曲线，实时更新）
- 预估剩余时间显示
- "停止训练"按钮
- 训练完成后自动跳转到评估页

提交：`feat(model-training): 完成模块5模型训练 [AC-5-01~AC-5-05]`

---

#### 模块 6：模型评估（AC-6-01 ~ AC-6-13）

后端：
- `GET /api/models/{id}/evaluation`：返回完整评估结果
  - 分类任务：准确率、精确率、召回率、F1、AUC-ROC、混淆矩阵、每类别指标
  - 回归任务：MSE、RMSE、MAE、R²、MAPE、残差分布
  - 学习曲线数据（不同训练集大小下的泛化性能）
  - 校准曲线数据（分类）
  - SHAP 摘要（特征重要性 top-20）
- `GET /api/models/{id}/shap`：SHAP 详细分析（summary plot、dependence plot 数据）
- `GET /api/models/{id}/learning-curve`：学习曲线

前端：
- 指标卡片区（一目了然显示核心指标）
- 混淆矩阵热力图（数量 + 百分比，ECharts）
- ROC 曲线图（ECharts，多分类显示 OvR）
- 残差分布图（回归）
- SHAP feature importance 条形图
- SHAP summary beeswarm 图
- 学习曲线图（过/欠拟合诊断）
- 与基线模型（逻辑回归/随机森林）对比表

提交：`feat(model-eval): 完成模块6模型评估 [AC-6-01~AC-6-13]`

---

### 阶段 3：优化与管理（模块 7-8）

**完成阶段 2 后自动开始**。

#### 模块 7：模型调优（AC-7-01 ~ AC-7-07）

后端：
- `POST /api/tuning/start`：启动 Optuna 超参数搜索（网格/随机/贝叶斯/TPE），返回 task_id
- `GET /api/tuning/{task_id}/progress`：**SSE 端点**，实时推送每次 trial 结果
- `POST /api/tuning/{task_id}/stop`：停止调优
- `GET /api/tuning/{task_id}/result`：最优参数 + 调优历史（每次 trial 的参数和分数）
- `GET /api/tuning/{task_id}/importance`：Optuna 参数重要性分析

前端：
- 搜索空间配置（每个参数的搜索范围，可拖拽设置）
- 实时调优进度（ECharts 散点图：每次 trial 的分数）
- 调优历史表格（可排序，高亮最优）
- 最优参数一键填回参数配置页
- 参数重要性条形图

提交：`feat(model-tuning): 完成模块7模型调优 [AC-7-01~AC-7-07]`

---

#### 模块 8：模型管理（AC-8-01 ~ AC-8-07）

后端：
- `GET /api/models`：列表（含指标摘要）
- `GET /api/models/{id}`：详情
- `DELETE /api/models/{id}`：删除
- `PUT /api/models/{id}/rename`：重命名
- `POST /api/models/{id}/tag`：打标签
- `GET /api/models/compare?ids=1,2,3`：多模型对比（指标并排）
- `POST /api/models/{id}/export`：导出模型文件（`.ubj` 或 `pickle`）

前端：
- 模型列表（卡片式，显示任务类型、核心指标、训练时间）
- 多选对比（最多 4 个模型并排指标对比表，ECharts 雷达图）
- 版本历史（同一数据集的所有模型按时间排列）
- 导出按钮

提交：`feat(model-mgmt): 完成模块8模型管理 [AC-8-01~AC-8-07]`

---

### 阶段 4：输出（模块 9-10）

**完成阶段 3 后自动开始**。

#### 模块 9：分析报告（AC-9-01 ~ AC-9-10）

后端：
- `POST /api/reports/generate`：生成完整分析报告（HTML + PDF）
  - 包含：数据概况、特征分析、模型评估、SHAP 解释、调优历史
  - PDF 使用 `weasyprint` 或 `reportlab` 生成
- `GET /api/reports/{id}`：获取报告元数据
- `GET /api/reports/{id}/download`：下载 PDF

前端：
- 报告配置面板（选择包含哪些章节、图表）
- 生成进度条
- 在线 HTML 预览（内嵌 iframe）
- 导出 PDF 按钮

提交：`feat(report): 完成模块9分析报告 [AC-9-01~AC-9-10]`

---

#### 模块 10：交互式预测（AC-10-01 ~ AC-10-09）

后端：
- `POST /api/prediction/batch`：批量文件预测（上传 CSV，返回带预测列的文件）
- `POST /api/prediction/single`：单条记录预测（JSON 输入，返回预测值 + 各类别概率 + SHAP 解释）
- `GET /api/prediction/{task_id}/download`：下载批量预测结果

前端：
- 模型选择下拉
- Tab 1：批量预测（拖拽上传 CSV，预测结果表格预览，下载按钮）
- Tab 2：手动输入预测（每个特征一个输入框，预测结果实时更新，SHAP 瀑布图解释）

提交：`feat(prediction): 完成模块10交互式预测 [AC-10-01~AC-10-09]`

---

### 阶段 5：全局验收与性能优化

**完成阶段 4 后自动开始**。

- 全局 UX（AC-G-01~AC-G-08）：主题切换、键盘快捷键、操作历史、错误处理统一
- 性能优化达标（AC-P 系列）：
  - 100k 行文件导入 < 10s
  - 模型训练（DS-01）< 30s
  - 应用冷启动 < 5s
  - PDF 报告导出 < 30s
  - 内存静止 < 500MB

提交：`feat(global-ux): 完成全局UX优化 [AC-G-01~AC-G-08]`

最终：`.\scripts\build-all.ps1` → 生成 `dist/XGBoost Studio Setup 1.0.0.exe`

打 tag：`git tag -a v1.0.0 -m "release: XGBoost Studio v1.0.0 正式版，通过全部89条验收标准"`

---

## 7. 参考文件位置

| 文件 | 说明 |
|------|------|
| `需求文档.md` | 每个模块的完整功能规格 |
| `验收标准文档.md` | 89 条验收用例，每条有前置条件/步骤/预期结果 |
| `开发规范.md` | 提交规范、代码规范、.gitignore 规范 |
| `docs/部署说明.md` | 终端用户安装说明、开发者环境搭建 |
| `server/pyproject.toml` | Python 依赖声明 |
| `xgboost-studio-windows/python/` | 已有的 xgb_engine 引擎代码（可复用） |

---

## 8. 测试数据集（阶段 0 完成后需创建）

在 `server/tests/fixtures/` 目录下创建以下测试数据：

| 文件 | 要求 |
|------|------|
| `titanic_train.csv` | 891行×12列，二分类，含 Survived 目标列 |
| `titanic_test.csv` | 418行×11列，无目标列 |
| `boston_housing.csv` | 506行×14列，回归任务 |
| `iris.csv` | 150行×5列，多分类 |
| `large_100k.csv` | 100000行×20列，用于性能测试 |
| `missing_heavy.csv` | 500行×10列，缺失率约30% |
| `multisheet.xlsx` | 含3个Sheet的Excel |
| `duplicate_rows.csv` | 200行含50条重复行 |

---

*本文件是 AI 自动生成 XGBoost Studio 的唯一入口指令，请勿删除。*
