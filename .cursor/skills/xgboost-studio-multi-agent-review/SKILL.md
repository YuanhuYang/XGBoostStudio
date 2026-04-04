---
name: xgboost-studio-multi-agent-review
description: >-
  六角色并行审视 XGBoost Studio：数据分析、模型训练、AI 专业学生、产品设计、架构师、测试专家。
  用于从各专业视角输出结构化《优化建议指南》，不替代代码改动，只产出可执行的审查结论与优先级。
---

# 多角色项目审视（本仓库）

## 何时使用

- 用户要求 **多视角评审**、**虚拟多角色**、**优化建议指南**、**并行审视**。
- 大版本/大 PR 前做 **风险与体验盘点**。
- **Harness 迭代内**：审视范围 **仅包含本迭代《迭代章程》/路线图中的冻结项**，勿评审整包未来需求（防蔓延）；产出可为精简版《迭代内优化摘要》。

## 六角色独立 Skill（可并行 @ 或分会话）

| 角色 | Skill 目录名（`.cursor/skills/…`） |
|------|-----------------------------------|
| 数据分析专家 | `xgboost-studio-role-data-analytics` |
| 模型训练专家 | `xgboost-studio-role-model-training` |
| AI 专业学生（用户视角） | `xgboost-studio-role-ai-student` |
| 产品设计专家 | `xgboost-studio-role-product-design` |
| 架构师 | `xgboost-studio-role-architect` |
| 测试专家（审视建议） | `xgboost-studio-role-test-advisor` |

**真并行**：开 **6 个 Agent/会话**，各加载上表对应 Skill，分别输出后由主编按下列「合并格式」汇总。  
**单会话**：按上表顺序依次输出六块，每块严格遵循该角色 Skill 中的 **四段结构**。

## 每角色统一输出格式

每个角色必须包含四段，且 **禁止空泛形容词**（如「更好」「优化」需改为可验收表述）：

1. **本角色关注点**（3–6 条 bullet）
2. **现状判断**（基于仓库真实路径/模块名；不确定写「待验证」+ 建议查看的文件）
3. **优化建议**（每条建议含：**优先级 P0/P1/P2**、**理由**、**建议改动位置** 如 `server/...` / `client/...`）
4. **开放问题**（需要产品/数据/业务拍板的事项）

## 合并产出物格式

最终汇总为一份 **《优化建议指南》**，顶部包含：

- **执行摘要**（≤10 行）
- **P0 行动项**（可当周完成）
- **按角色分章**（六章，每章结构一致）
- **跨角色冲突**（例如「产品要简化」vs「架构要可扩展」）单独列表

## 与本仓库其它 Skill 的关系

- **大需求**：先经 **`xgboost-studio-pm-harness`** + **`xgboost-studio-role-project-manager`** 拆迭代，再对每个迭代做 A→B→C。
- 指南/摘要产出后，**功能落地** 使用 **`xgboost-studio-rd-implementation`**；再进入 **`xgboost-studio-test-delivery`**（本迭代测试子集 + 章程中的回归）。
- 若仅评审、不要求写代码：本 Skill 与六角色分角即可；不要在本 Skill 里写大量实现或测试代码。
- 测试专家 **审视** 用 **`xgboost-studio-role-test-advisor`**；**写测例 + 全量跑 + DoD** 用 **`xgboost-studio-test-delivery`**。
