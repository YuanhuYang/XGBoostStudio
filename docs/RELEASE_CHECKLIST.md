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

- [ ] Electron 安装包：在仓库根目录执行 `.\scripts\build-server.ps1` 后 `.\scripts\build-client.ps1`（`build-client` 会将 `server\dist\xgboost-server.exe` 复制到 `client\resources\` 再打包含 NSIS）。耗时长，环境敏感（若 `rcedit` 报 *Unable to commit changes*，见 `client/package.json` 中 `win.signAndEditExecutable`）。

## 4. 最近一次实测摘录（维护者更新）

| 步骤 | 环境 | 结果摘要 |
|------|------|----------|
| `uv sync --all-groups --frozen` + `uv run pytest -q` | Windows 10, Python 3.12（uv 管理） | 11 passed（含 Titanic→PDF 全链） |
| `npm run typecheck` | Windows 10, Node 20 | 通过（无输出错误） |
| `python tests/check_wizard.py` | 同上 | 退出码 0，PARAM_SCHEMA 14 params |

端到端 `acceptance_test.py` 未在本表代跑（需独立起服务）；发版前请补一行结果。

## 5. 商业验收抽样记录（Harness D2）

- 详见 [`docs/验收执行记录-20260405.md`](验收执行记录-20260405.md)（文档对齐 + API 自动化证据；**全链路 UI 需在客户端人工补跑**）。
- F3 分模块抽样表：[`docs/验收抽样-F3-分模块.md`](验收抽样-F3-分模块.md)。

## 6. 打包验证（Harness M2）

| 步骤 | 环境 | 结果摘要 |
|------|------|----------|
| `.\scripts\build-server.ps1` | Windows 10 | 成功 → `server\dist\xgboost-server.exe`（PyInstaller 有 WARNING 可查阅 `server\build\build\warn-build.txt`） |
| `.\scripts\build-client.ps1` | Windows 10 | 成功 → `dist\XGBoost Studio Setup 0.1.0.exe` 与 `dist\win-unpacked\` |
