---
name: xgboost-studio-pm-harness
description: >-
  Harness 式工程编排：项目经理拉齐多角色定优先级与排期，将 A/B/C 拆成多个可商用迭代；
  配合 Cursor Plan 模式，小需求独立 Agent 上下文。大需求或全链路交付时优先启用。
---

# Harness 式迭代交付（本仓库）

## 思想（对齐「Harness Engineering」）

- **小束迭代**：每次交付是一个 **可独立发布/商用** 的增量，而不是长期不可发布的半成品。
- **范围束带**：每迭代启动前 **冻结范围**（Scope charter）；中途新增需求默认进 **下一迭代**，防止蔓延。
- **证据链**：每迭代结束仍走 **C 阶段 DoD**（见 `xgboost-studio-test-delivery`），可缩小为 **本迭代测试子集 + 强制回归清单**（写在章程里）。

## 何时使用

- 用户提到 **项目经理、排期、多迭代、Harness、Plan 模式、范围蔓延、商用交付**。
- 任何 **大于一周直觉工时** 或 **跨 server/client 多模块** 的需求。

## 推荐流程

### 0 — Plan（必须先做）

在 Cursor 中 **开启 Plan 模式**，或使用 **仅规划对话**（本步不写产品业务代码）：

1. 加载 **`xgboost-studio-role-project-manager`**，产出 **《迭代路线图》** 草案。
2. 可选：六角色仅对 **Backlog 优先级** 各写 **3 条以内** 意见（不必完整 A 阶段长文），PM 合并进路线图。
3. 路线图每一行即 **一个迭代**，包含下表字段。

### 《迭代路线图》字段（每行一迭代）

| 字段 | 说明 |
|------|------|
| 迭代 ID | 如 I1, I2… |
| 目标 | 一句话用户/业务价值 |
| 范围冻结 | 明确列表（功能点/接口/页面）；**非列表内不做** |
| 商用/交付定义 | 如何验收「可交付」（演示脚本、发布说明、无 P0 缺陷等） |
| 依赖 | 前置迭代或外部条件 |
| 测试策略 | 本迭代 **必跑命令子集** + **回归用例集**（可引用 AGENTS.md） |
| Agent 切分 | 每条独立 backlog 对应 **建议新开 Agent 会话** 的说明 |

### 每迭代内：小 A → B → C

- **A（审视）**：仅针对 **本迭代范围** 做六角色审视（可压缩篇幅）；输出 **《迭代内优化摘要》** 或直接引用路线图若已足够。
- **B（实现）**：**`xgboost-studio-rd-implementation`**，输入为 **本迭代《迭代章程》**（路线图该行的冻结范围）。
- **C（测试）**：**`xgboost-studio-test-delivery`**，测试范围 **= 本迭代实现 + 章程中回归集**；DoD 满足后才可合并/发布本束。

### Agent 上下文策略

- **一个独立 backlog 项 → 优先一个独立 Composer/Agent 会话**；PM 在路线图中写明，避免「一个超长上下文做完所有迭代」。
- 需要连贯时：最多 **「单迭代内」** 串 A→B→C，跨迭代 **新开会话**。

## 与全局规则的关系

仓库规则 **`plan-mode-harness.mdc`** 要求大任务 **先 Plan**；本 Skill 提供 **模板与字段**。

## 相关 Skill

- PM 角色：**`xgboost-studio-role-project-manager`**
- A 汇总格式：**`xgboost-studio-multi-agent-review`**
- B / C：**`xgboost-studio-rd-implementation`**、**`xgboost-studio-test-delivery`**
