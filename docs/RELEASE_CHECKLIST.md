# 发布 / 交付检查清单（工程基线）

与 Harness 里程碑 **M1** 对齐：合并或发版前按下列命令 **实际执行** 并保留日志或截图摘要；禁止未跑声称通过（见 `xgboost-studio-test-delivery` DoD）。

## 1. PR 级门禁（与 CI 一致）

在干净环境中执行，结果须与 GitHub Actions **CI** job 一致。

- [ ] **后端**（工作目录 `server/`）  
  `uv sync --all-groups --frozen`  
  `uv run pytest -q`
- [ ] **客户端**（工作目录 `client/`）  
  `npm ci`  
  `npm run typecheck`

## 2. 产品级全量（合版 / 里程碑建议）

在 PR 门禁通过后再执行。

- [ ] **后端 pytest**（同上，可再跑一遍全量）：`uv run pytest`（勿默认收集 `acceptance_test.py`，见 `server/tests/conftest.py`）。
- [ ] **脚本式端到端验收**（需 API 已启动，默认 `http://127.0.0.1:18899`）：在 `server/` 下  
  `python tests/acceptance_test.py`
- [ ] **可选静态检查**：`python tests/check_wizard.py`（参数 schema 完整性，无需起服务）。

## 3. 非 PR 必跑（按需）

- [ ] Electron 安装包：`cd client && npm run build`（耗时长，环境敏感，里程碑或发版前再跑）。

## 4. 最近一次实测摘录（维护者更新）

| 步骤 | 环境 | 结果摘要 |
|------|------|----------|
| `uv sync --all-groups --frozen` + `uv run pytest -q` | Windows 10, Python 3.12（uv 管理） | 7 passed |
| `npm run typecheck` | Windows 10, Node 20 | 通过（无输出错误） |
| `python tests/check_wizard.py` | 同上 | 退出码 0，PARAM_SCHEMA 14 params |

端到端 `acceptance_test.py` 未在本表代跑（需独立起服务）；发版前请补一行结果。
