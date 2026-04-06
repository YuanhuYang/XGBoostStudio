# 发布 / 交付检查清单（工程基线）

与 Harness 里程碑 **M1** 对齐：合并或发版前按下列命令 **实际执行** 并保留日志或截图摘要；禁止未跑声称通过（见 `xgboost-studio-test-delivery` DoD）。

**商业化全量验收**：PR 级命令 **不**等价于《迭代计划》全功能 AC 通过；发版前另查 [`功能需求与验收状态.md`](功能需求与验收状态.md)。**对外**宣称「迭代计划范围已验收通过」须满足该文档 **第二节目标范围全为通过 + 第四节签核**（见 [`迭代计划.md`](迭代计划.md) 验收门禁）。

**产品与流程**：持续迭代（G2+）与全量验收（G1）可并行，见 [`迭代计划.md`](迭代计划.md) **G2+**；**每次商用发布** 仍须完成本节 **§0**。**产品版本号** 与 **迭代 ID** 的对应关系见 [`版本与发布.md`](版本与发布.md)（发布记录表 + 版本文件一致）。

## 0. 商用发布质量保障（一页核对 · 项目经理 / QA）

发版或对外交付窗口前快速过一遍（未勾选完毕则按风险降级对外话术，见 [`功能需求与验收状态.md`](功能需求与验收状态.md) 文首）：

- [ ] **CI 绿**：§1 后端 `pytest` + 前端 `typecheck` 已与主干一致通过。
- [ ] **当期范围对齐**：[`功能需求与验收状态.md`](功能需求与验收状态.md) §二 **发布口径**（脚注/执行记录）与本次发版一致；**全量适用 AC** 已执行并留痕，或 **豁免已书面批准** 并登记风险。
- [ ] **签核**：同上文档 §四 **五领域** 已填（**质量门禁（QA）行 = QA Owner**）。
- [ ] **B 档**（若本次发 **安装包**）：完成 §6 构建，并在目标环境 **断网/双击安装** 快验主路径。
- [ ] **对外表述**：未满足 §二+§四 前，合同/官网/发版说明 **不得** 写「迭代计划范围已验收通过」。

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
| `uv sync --all-groups --frozen` + `uv run pytest -q` | Windows 10, Python 3.12（uv 管理） | **41 passed**（2026-04-05，CQ-2 回归）；历史行「11 passed」为早期摘录 |
| `npm run typecheck` | Windows 10, Node 20 | 通过（无输出错误） |
| `uv run python tests/check_wizard.py`（`server/`） | 同上 | 退出码 0，PARAM_SCHEMA 14 params（勿用系统 `python`，见 CQ-1 执行记录） |
| `uv run python tests/acceptance_test.py`（`server/`，18899 已起当前构建 API） | 同上 | **通过**（2026-04-05，CQ-2）；成功行 ASCII，避免 GBK 控制台编码错误 |

详情与 B 档构建证据：[`docs/iterations/CQ-2/执行记录.md`](../iterations/CQ-2/执行记录.md)。

## 5. 商业验收抽样记录（Harness D2）

- 详见 [`执行记录.md`](../iterations/harness-D2/执行记录.md)（文档对齐 + API 自动化证据；**全链路 UI 需在客户端人工补跑**）。  
- G2-Auth-1 运行档案专项证据：[`执行记录.md`](../iterations/G2-Auth-1/执行记录.md)（与全量 §二 **并列**，不替代商用发布签核）。
- F3 分模块抽样表：[`抽样-F3-分模块.md`](../evidence/抽样-F3-分模块.md)。**商用发布全量依据以 §0 + [`验收标准文档.md`](验收标准文档.md) 全量 AC 为准**，抽样不能替代。

## 6. 打包验证（Harness M2）

| 步骤 | 环境 | 结果摘要 |
|------|------|----------|
| `.\scripts\build-server.ps1` | Windows 10 | 成功 → `server\dist\xgboost-server.exe`（PyInstaller 有 WARNING 可查阅 `server\build\build\warn-build.txt`） |
| `.\scripts\build-client.ps1` | Windows 10 | 成功 → `dist\XGBoost Studio Setup 0.1.0.exe` 与 `dist\win-unpacked\` |