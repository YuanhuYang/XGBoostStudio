# xs-studio 命令行（AutoML REPL）

在 [`server/cli`](../../server/cli) 下实现：默认**启动后端子进程**并进入 **REPL**，与浏览器中的前端（Vite/Electron）共用同一 API 与数据库。

产品与 Wiki 中的能力边界、API 表、编排步骤见 **[全自动建模与向导（08-automl-wizard）](../wiki/08-automl-wizard.md)**（§2.2 命令行模式与本指南对应）。

## 环境

- Python 3.12+，在 **`server`** 目录使用 `uv`：

```bash
cd server
uv sync
```

## 启动方式

**交互（推荐）**

```bash
uv run python -m cli.main
```

等价：

```bash
uv run python -m cli.main shell
```

**已有后端时**（不拉子进程）：

```bash
uv run python -m cli.main --base-url http://127.0.0.1:18899
```

**一键跑文件**（上传 → AutoML → 可选 PDF → 打印前端深链）：

```bash
uv run python -m cli.main run /path/to/data.csv --skip-tuning
uv run python -m cli.main run ./data.xlsx --pdf --sheet Sheet1
```

常用参数：`--host` `--port` `--keep-server`（退出后保留 uvicorn）`--frontend-url` / `--print-frontend-url`（深链里的前端根地址，默认 `http://127.0.0.1:5173`，两参数等价）。

## 跨平台示例

**Linux / macOS（Bash）**

```bash
cd server && uv run python -m cli.main
```

**Windows PowerShell**

```powershell
Set-Location D:\workspace\XGBoostStudio\server
uv run python -m cli.main
```

**Windows CMD**

```cmd
cd /d D:\workspace\XGBoostStudio\server
uv run python -m cli.main
```

## REPL 命令摘要

| 命令 | 说明 |
|------|------|
| `load <路径> [sheet]` | 上传 CSV/XLSX |
| `sample <key>` | 导入内置示例；**无参**时打印全部可用 `key`（与 `GET /api/datasets/builtin-samples` 及前端「添加示例数据」同源） |
| `datasets` | 列出数据集 |
| `automl [--skip-tuning] ...` | 全自动建模（SSE 进度） |
| `candidates` | 上次候选与系统推荐 |
| `select <n>` / `select_model <id>` | 选用模型 |
| `pdf [--compare-only\|--no-compare\|--selected]` | 生成 PDF |
| `detach` | 之后 `quit` 仍保留后端 |
| `urls` | 打印带 `datasetId` / `modelId` / `xsPage` 的前端深链 |

## 与前端联调

1. 终端运行 `uv run python -m cli.main`（或 `--base-url` 指向已启动的后端）。
2. 另开终端启动前端（如 `cd client && npm run dev:web`，端口以实际为准）。
3. 在 REPL 执行 `urls`，将浏览器打开打印的链接；前端会读取查询参数并设置当前数据集/划分/模型上下文（见 `MainLayout`）。

## 控制台脚本

[`pyproject.toml`](../../server/pyproject.toml) 中声明了 `[project.scripts] xs-studio`。若使用 `uv` 且项目未作为可安装包发布，请以 **`python -m cli.main`** 为准；安装为包后可使用 `xs-studio` 命令。

## 测试

```bash
cd server
uv run pytest tests/test_cli_smoke.py tests/test_automl.py -v
```
