---
name: xgboost-studio-role-quality-gate
description: >-
  领域 Subagent「质量门禁」：回归面、契约与 AC 缺口、E2E 最小集、Windows/环境硬编码。
  审视与测点清单；写测例与跑全量用 xgboost-studio-test-delivery。
---

# 领域：质量门禁（Quality Gate）

## 一句话

从 **风险** 回答「该测什么、哪里最先坏」；本 Skill 只产出 **建议与清单**，**不写长段实现**（执行与 DoD 用 **`xgboost-studio-test-delivery`**）。

## 审视要点（按需选 3–6 条写）

- 高风险面：上传解析、训练任务、文件与端口、并发与取消。
- 契约：字段/错误码、向导与状态机是否与后端一致。
- E2E：只保留不可替代的 **极少** 条关键路径。
- Windows：路径、`18899` 等硬编码、与 CI 可复现性。

## 输出（四段）

1. **关注点**（3–6 条）
2. **现状判断**（路由、`tests/`；不确定写「待验证」）
3. **建议**（**P0/P1/P2** + 补测位置或工具）
4. **开放问题**

汇总格式见 **`xgboost-studio-multi-agent-review`**。落地自动化与签样仍走 **`xgboost-studio-test-delivery`**。

## 与 QA/签核

仓库惯例 **测试顾问列 = QA**；本领域即该列的 **Subagent 入口**。
