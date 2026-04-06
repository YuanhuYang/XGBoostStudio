---
name: xs-skill-guardrails
description: >-
  Skill/流程闸口：防止「只写过程文档不落地」、算法误改、架构选型无留痕、UTF-8/首屏文档损坏。
  在 PM 定范围后，与 xs-pm-harness、xs-rd-implementation、xs-doc-steward、xs-role-modeling-eval 配合使用。
---

# Skill 体系闸口（Guardrails）

## 何时使用

- 用户抱怨：**需求/文档讨论多、合并少、越改越差**。
- 变更涉及：**训练/指标/损失/特征管线/报告数值** 等算法或统计语义。
- 变更涉及：**根 README、产品首屏、CONVENTIONS** 或大批量 Markdown。
- 引入或调整 **跨模块架构**（新依赖、进程模型、API 形态、Electron 打包边界）。

## 核心规则（必须遵守）

### 1. 交付物绑定代码或显式 N/A

- 每个迭代结束：**要么** 有可审查的 **代码/配置 diff**，**要么** 在 `执行记录.md` 写 **「本迭代无代码变更」** 及原因。
- **禁止** 仅新增过程文档却声称迭代完成；文档变更若为用户可见，须列入 **范围冻结**。

### 2. 算法与建模类变更（P0）

- 修改前：在 `设计.md` 或 PR 描述中写清 **行为变更摘要**、**风险**、**回滚策略**。
- 修改后：**至少** 运行与改动模块相关的 **`uv run pytest`** 子集（由 `xs-test-delivery` / 章程规定）；若触及 API 契约，同步 **OpenAPI / 契约测例**。
- 建议 **`@ xs-role-modeling-eval`** 做 A 阶段要点评审（可压缩篇幅）。

### 3. 架构选型（轻量 ADR）

- 任何「换方案/引新库/改进程或端口模型」：在对应迭代 `设计.md` 增加 **ADR 小节**（≤15 行）：**背景 / 选项 / 决定 / 后果**。
- 由 **`@ xs-role-systems-contract`** 审视边界与可部署性。

### 4. 文档与编码（P0）

- 所有仓库 Markdown：**UTF-8（无 BOM）**；提交前打开根 `README.md` 检查 **不出现成片 `?` 替代字符**。
- 大批量改文档：**先** 跑链接/规范自检（见 `xs-doc-steward`），**再** 合并。

### 5. 会话与上下文

- **禁止** 在单一超长上下文内串完多迭代或多条 backlog；按 `xs-pm-harness` **Agent 切分**执行。

## 与现有 Skill 的关系

| 能力 | 配合 |
|------|------|
| 范围与排期 | `xs-role-project-manager`、`xs-pm-harness` |
| 实现 | `xs-rd-implementation` |
| 测试与 DoD | `xs-test-delivery`、`xs-testing` |
| 文档树与 CONVENTIONS | `xs-doc-steward` |
| 五领域审视 | `xs-multi-agent-review` + 各 `xs-role-*` |

## 输出（Agent 自检清单）

在 PR 或 `执行记录.md` 末尾勾选：

- [ ] 本迭代是否有代码变更？若无，是否写明 N/A 原因？
- [ ] 是否触及算法/指标？相关 pytest 子集命令与结果是否记录？
- [ ] 是否有架构决策？`设计.md` ADR 是否已写？
- [ ] 用户可见 Markdown 是否 UTF-8 且无 `?` 乱码？
