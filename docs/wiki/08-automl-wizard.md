# 全自动建模（AutoML）与向导集成

> **版本对应**：v0.4.x（与根目录 README / `01-product-overview` 一致）  
> **最后更新**：2026-04-06（补充命令行模式 `xs-studio`）

---

## 一、能力边界

| 产品承诺 | 说明 |
|----------|------|
| 可以做到 | 在**固定试验预算**内自动完成：目标列启发式、训练/测试划分、规则推荐参数、**多个候选模型**训练（规则基线、保守正则、可选轻量 Optuna），并按验证集主指标结合 **`overfitting_level`** 做排序与说明。 |
| 不承诺 | **全局最优**；严格杜绝过拟合/欠拟合。控制手段为 hold-out、正则、早停（若配置）、以及指标中的 **train/val 差距** 展示与排序惩罚。 |

---

## 二、用户入口

编排能力在 UI 与命令行下**一致**，均调用同一套 **`POST/GET /api/automl/...`**（见下文第三节），共用 SQLite 与文件目录；区别仅在于触发方式与进度展示载体。

### 2.1 向导模式（图形界面）

- **页面**：`client/src/pages/SmartWorkflow/index.tsx`，**Step 0（选择数据集）** 下方卡片「全自动建模（一键完成）」。
- **选项**：**快速模式**（跳过轻量调优，仅训练两个候选）；非快速模式下可配置 **调优试验次数**（上限由后端约束）。
- **交互**：`EventSource` 订阅 `GET /api/automl/jobs/{job_id}/progress` 展示步骤日志；完成后 `GET /api/automl/jobs/{job_id}/result` 拉取结构化结果；**Radio** 切换主模型并同步全局 `activeDatasetId` / `activeSplitId` / `activeModelId` 与 `pipelineResult`，可跳转「结果总结」。
- **前端封装**：`client/src/api/automl.ts`（`startAutoMLJob`、`getAutoMLJobResult`）。

### 2.2 命令行模式（xs-studio）

面向**开发者 / 自动化 / 无头服务器**：在 `server` 目录通过 **`python -m cli.main`**（`pyproject` 中登记名 `xs-studio`）进入交互式 **REPL**，默认**子进程启动 uvicorn**，再用 **httpx** 调用与 UI 相同的上传、AutoML、报告等 API。

| 能力 | 说明 |
|------|------|
| 默认无参 / `shell` | 启后端 → 等待 `/health` → 进入 REPL（`load` / `sample` / `automl` / `candidates` / `select` / `pdf` / `urls` 等） |
| `run <路径>` | 非交互：上传 CSV/XLSX → AutoML → 可选 `--pdf`，打印 `dataset_id`、`model_id`、报告下载 URL、**前端深链** |
| 与浏览器并行 | REPL 运行期间可另开终端启动 `npm run dev:web`（或 Electron），数据实时写入同一数据库 |
| 深链同步上下文 | REPL `urls` 或 `run` 输出带 `datasetId`、`splitId`、`modelId`、`xsPage` 的 URL；前端 `MainLayout` 首次就绪时解析 query 并写入全局 store |
| 保留后端 | 启动参数 `--keep-server` 或 REPL 内 `detach`：`quit` 后不终止 uvicorn |
| 已有后端 | `--base-url http://127.0.0.1:18899` 时不启子进程，仅连现有 API |

完整命令表、PowerShell / macOS / Linux 示例、测试说明见 **[《xs-studio CLI 指南》](../guides/xs-studio-cli.md)**；实现目录：`server/cli/`（`main.py`、`repl.py`、`api_client.py`、`server_proc.py`）。

---

## 三、后端 API（`http://127.0.0.1:18899`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/automl/jobs` | Body：`dataset_id`（必填），`target_column`、`train_ratio`、`random_seed`、`max_tuning_trials`、`skip_tuning`（可选）。返回 `{ "job_id": "..." }`。后台线程执行编排，**任务状态仅存内存**，进程重启后丢失。 |
| GET | `/api/automl/jobs/{job_id}/progress` | **SSE**。多行 `data: {JSON}` 为步骤事件；流结束为 `event: done`。若失败，先推送含 `error` 的 `data:`，仍以 `done` 结束。 |
| GET | `/api/automl/jobs/{job_id}/result` | `status === completed` 时返回完整结果；失败或未结束时返回 400/404。 |

---

## 四、编排逻辑（服务层）

实现位置：`server/services/automl_service.py`。

1. **目标列**：`target_recommend.recommend_target_columns` 生成 `candidate_targets`（多维度评分 + softmax 归一化，详见 [03-data-analysis.md §二](03-data-analysis.md#二目标列智能推荐)）→ 已设 `target_column` → 末列兜底；可请求体覆盖。  
2. **划分**：`dataset_service.split_dataset`（`stratify` 由任务类型推断）。  
3. **基线参数**：`params_service.recommend_params`。  
4. **候选训练**：`training_service.train_and_persist_sync`（不落 `TrainingTask`）。  
   - 候选 A：规则基线。  
   - 候选 B：保守正则（更浅树、更强正则等启发式）。  
   - 候选 C（可选）：`tuning_service.run_lite_tuning_best_params` 后再同步训练。  
5. **排序**：分类侧重 AUC/accuracy，回归侧重 RMSE；对 `overfitting_level === high/medium` 施加惩罚，结果写入 `score_for_rank` 与 `chosen_recommendation.reason`。

路由与内存任务表：`server/routers/automl.py`（`JOBS` dict），于 `server/main.py` 注册。

---

## 五、测试

- AutoML API：`server/tests/test_automl.py`（示例：导入内置 **boston** → 快速模式 → 消费 SSE → 校验 `result.candidates`）。  
- CLI 所用 HTTP 路径：`server/tests/test_cli_smoke.py`（与 `StudioHttpClient` 一致的 URL 顺序）。  
- 运行：`cd server && uv run pytest tests/test_automl.py tests/test_cli_smoke.py -q`（需本机 SciPy/sklearn 可正常加载）。

---

## 六、相关文档

- 命令行模式专页：[xs-studio CLI 指南](../guides/xs-studio-cli.md)  
- 技术架构总览：[02-architecture.md](02-architecture.md)（路由树、SSE 列表、`server/cli`）  
- 产品侧向导说明：[01-product-overview.md](01-product-overview.md)  
- 同步训练编排复用：[04-model-training.md](04-model-training.md) §八 `train_and_persist_sync`  
- 轻量调参与 5 阶段主路径：[05-auto-tuning.md](05-auto-tuning.md) §七 `run_lite_tuning_best_params`  

---

## 七、版本历史

| 日期 | 摘要 |
|------|------|
| 2026-04-06 | 新增 §2.2 命令行模式（xs-studio）、测试与相关文档链接更新 |
