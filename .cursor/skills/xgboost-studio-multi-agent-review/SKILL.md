---
name: xgboost-studio-multi-agent-review
description: >-
  五领域并行审视 XGBoost Studio：数据与可复现、建模与评估、产品体验、系统与契约、质量门禁。
  产出结构化《优化建议指南》或迭代内摘要；不替代代码改动。
---

# 多领域项目审视（本仓库）

## 何时使用

- 用户要求 **多视角评审**、**虚拟多角色**、**优化建议指南**、**并行审视**。
- 大版本/大 PR 前做 **风险与体验盘点**。
- **Harness 迭代内**：审视范围 **仅含本迭代《迭代章程》/路线图冻结项**；产出可为精简版《迭代内优化摘要》。

## 五领域 Subagent（可并行 @ 或分会话）

| 领域（对外称谓） | Skill 目录（`.cursor/skills/…`） |
|------------------|-----------------------------------|
| 数据与可复现 | `xgboost-studio-role-data-reproducibility` |
| 建模与评估 | `xgboost-studio-role-modeling-eval` |
| 产品体验（流程 + 可学性） | `xgboost-studio-role-product-experience` |
| 系统与契约 | `xgboost-studio-role-systems-contract` |
| 质量门禁 | `xgboost-studio-role-quality-gate` |

**真并行**：开 **5 个** Agent/会话，各加载上表 Skill，分别输出后由主编按「合并格式」汇总（**Token 优于 6 会话旧版**）。  
**单会话**：按上表顺序依次输出五块，每块遵循该领域 Skill 的 **四段结构**。

**PM 裁剪**：若某领域与本轮 **无关**，路线图标注 **跳过**，不强行开会话（见各领域 Skill 内「何时可跳过」）。

## 与历史「六角色」签核表的对照

仓库 `docs/` 中仍可能出现的列名 **数据分析 / 模型训练 / 产品设计 / 架构 / 测试顾问** 与本表映射见 **`.cursor/README.md`（Subagents · 签核列名映射）**；「AI 专业学生」视角已并入 **产品体验**。

## 每领域统一输出格式

每段必须包含四节，且 **禁止空泛形容词**：

1. **本领域关注点**（3–6 条 bullet）
2. **现状判断**（仓库真实路径/模块；不确定写「待验证」+ 建议打开的文件）
3. **优化建议**（每条：**P0/P1/P2**、**理由**、**建议改动位置**）
4. **开放问题**

## 合并产出物格式

汇总为 **《优化建议指南》**，顶部包含：

- **执行摘要**（≤10 行）
- **P0 行动项**
- **按领域分章**（**五章**，结构一致）
- **跨领域冲突** 单独列表

## 与本仓库其它 Skill 的关系

- **大需求**：先 **`xgboost-studio-pm-harness`** + **`xgboost-studio-role-project-manager`** 拆迭代，再每迭代 A→B→C。
- 指南产出后：**`xgboost-studio-rd-implementation`** → **`xgboost-studio-test-delivery`**（本迭代子集 + 章程回归）。
- 仅评审不写代码：本 Skill + 五领域分角即可。
- **质量门禁** 审视用 **`xgboost-studio-role-quality-gate`**；**写测例 + 全量跑 + DoD** 用 **`xgboost-studio-test-delivery`**。
