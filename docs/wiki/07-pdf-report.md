# XGBoost Studio · 12 章专业 PDF 报告

> **版本对应**：v0.5.x  
> **最后更新**：2026-04-07  
> **对应代码**：`server/services/report_service.py`、`server/schemas/model.py`（BrandConfig）、`client/src/pages/Report/`、`client/src/constants/reportSections.ts`  
> **质量分与预处理审计口径**：见 [`09-data-quality-unified-and-smart-clean.md`](09-data-quality-unified-and-smart-clean.md)

---

## 设计理念

XGBoost Studio 的 PDF 报告**不是图表导出工具**，而是**面向不同受众的专业分析报告自动生成系统**：

- **内容有逻辑闭环**：业务目标 → 数据准备 → 建模调优 → 准确性验证 → 可解释性 → 结论建议
- **每个结论有数据支撑**：所有数值均来自前两个分析域（数据分析 + 模型评估）的计算结果，无主观臆造
- **面向多受众**：同一套分析结果，通过不同预设模板输出给管理层、业务团队、技术专家、合规审计人员
- **100% 本地生成**：全程离线，不依赖任何在线 API 或 AI 大模型，所有文本由内置规则库生成

---

## 一、12 章固定结构

| 章节序号 | 章节标题 | 强制包含的内容摘要 |
|----------|----------|-------------------|
| **第一章** | 报告摘要与建模目标 | 业务背景、建模目标、核心指标结论、报告导读 |
| **第二章** | 标签与数据集专项分析 | 标签口径、标签分布、数据集划分规则、泄露检测结果 |
| **第三章** | 特征工程全流程分析 | 原始特征池分析、IV/KS/PSI效力排名、特征稳定性、最终入模特征 |
| **第四章** | XGBoost建模与超参数调优全链路过程 | 基线模型、初始配置、5阶段调优记录、训练过程全记录 |
| **第五章** | 模型准确性与泛化能力全维度分析 | 拟合度、核心指标、最优阈值、OOT泛化、鲁棒性测试、坏样本诊断 |
| **第六章** | 模型可解释性分析 | 特征重要性（gain/weight/cover）、PDP/ICE、SHAP全维度 |
| **第七章** | 模型合规性与风险分析 | 全链路风险识别、公平性分析、模型生命周期预测 |
| **第八章** | 业务落地与应用建议 | 业务价值量化、落地路径、阈值使用建议、监控要求 |
| **第九章** | 结论与优化方向 | 建模全流程结论、核心优势/局限性、后续优化方向 |
| **第十章** | 附录 | 训练环境、超参数明细表（含调优依据）、可复现代码片段 |

---

## 二、4 种预设模板

根据受众不同，4 种模板分别包含不同的章节集合，生成时间和报告长度也不同：

### 管理层简报版（Executive Brief）

**包含**：第1章 + 第5章 + 第8章 + 第9章  
**特点**：去掉技术细节，只保留"结果是什么"和"业务怎么用"，通常 5-10 页  
**适用场景**：周会汇报、项目立项评审、管理层决策参考

### 业务执行版（Business Execution）

**包含**：第1-5章 + 第8章 + 第9章  
**特点**：完整建模过程 + 业务建议，保留调优过程但省略深度技术分析，通常 15-25 页  
**适用场景**：业务团队参考、项目组内交流、向客户汇报

### 技术专家版（Technical Expert）

**包含**：第1-6章 + 第7章 + 第9章 + 第10章（不含第8章）  
**特点**：包含可解释性和附录（复现代码），聚焦算法严谨性，通常 30-50 页  
**适用场景**：算法团队内审、技术评审、学术研究

### 合规审计版（Compliance Audit）

**包含**：第1章 + 第2-3章 + 第5章 + 第7章 + 第9章 + 第10章  
**特点**：强调数据合规（泄露检测）、风险管控（合规性章节）、可复现性（附录），通常 20-30 页  
**适用场景**：内部审计、监管报送、《个人信息保护法》合规自查

---

## 三、完整 12 章版（Full 12 Chapters）

包含所有 10 个章节，完整覆盖建模全流程，通常 50-80 页。  
适用于：技术档案存档、科研发表、合同附件。

---

## 四、报告内容自动生成逻辑

### 数据来源

所有报告内容来自三个数据源，无人工干预：

```
1. 数据库中的模型记录
   └── params_json（超参数明细）
   └── metrics_json（评估指标）
   └── provenance_json（运行档案）
   └── cv_*（K折结果）

2. 调优任务记录
   └── tuning_diagnostics_json.phase_records（5阶段完整记录）

3. 数据集侧审计（随模型关联的数据集一并加载）
   └── datasets.preprocessing_log_json
       └── 用户在工作台或（启用时）AutoML 智能清洗触发的 handle_missing / drop_duplicates / handle_outliers 等
       └── 由 dataset_narrative_service._load_preprocessing_audit 解析为叙事条目

4. 实时计算（报告生成时触发）
   └── get_evaluation()（混淆矩阵、ROC、SHAP等）
   └── get_learning_curve()（学习曲线）
   └── build_data_narrative()（数据叙事，G2-R1；含预处理审计列表）
```

**与质量分的一致性**：数据工作台与智能向导使用的综合质量分均由 `dataset_service.get_quality_score` 定义（缺失率、行级 3σ 异常率、重复率加权）；PDF 正文不重复打印该分数公式，但在「数据与变量关系」章节含有**固定方法论说明**，并列出 `preprocessing_log_json` 解析出的操作记录（若有）。**训练阶段默认处理**（同章节后续小节）描述的是服务端 XGBoost 训练管线对缺失/标签的约定，与上述用户侧清洗**相互独立**。

**AutoML 策略摘要**：若仅存在于内存任务结果的 `pipeline_plan` 未写入模型 `provenance_json`（或数据集日志），则当前 PDF **不会**单独成章；需要时可后续迭代持久化后再扩展叙事。

### 文本内容生成规则

报告中的解释性文字通过**内置规则库**自动生成（非 AI 大模型），主要规则：

- 过拟合诊断：根据 `overfitting_level`（low/medium/high）生成对应描述和建议
- 指标评级：根据 AUC/KS/PSI 等指标数值对应判读标准生成文字
- 调优过程描述：将 `phase_records` 中的 `phase_goal`、`selection_rationale`、`effect_improvement` 组装为叙事段落
- 业务建议：根据任务类型（分类/回归）和模型表现生成标准化建议

---

## 五、品牌定制

### 可定制内容

| 配置项 | 字段名 | 效果 |
|--------|--------|------|
| 企业名称 | `company_name` | 替换封面、页眉页脚的"XGBoost Studio"字样 |
| 水印文字 | `watermark_text` | 在每页添加45°旋转水印（如"机密"、"CONFIDENTIAL"） |
| 主色调 | `primary_color_hex` | 替换报告中标题、分隔线、表格表头的蓝色（#1677ff） |
| Logo | `logo_path` | （规划中）在封面和页眉显示企业 Logo |
| 自定义页脚 | `footer_text` | 替换默认页脚文字 |

### API 请求示例

```json
{
  "model_id": 5,
  "template_type": "compliance_audit",
  "brand_config": {
    "watermark_text": "内部使用",
    "company_name": "某金融科技公司 · 风险模型部",
    "primary_color_hex": "#003087"
  }
}
```

---

## 六、报告生成流程

```
POST /api/reports/generate
    │
    ├── 加载模型记录（params + metrics）
    ├── 根据 template_type 确定章节集合
    ├── 实时计算评估数据（eval_service）
    ├── 构建 ReportLab Story 对象序列
    │       ├── 封面页（含品牌信息）
    │       ├── 目录页（含章节列表）
    │       └── 各章节 Flowable 对象
    ├── 应用品牌配置（水印 / 主色）
    ├── doc.build() → 生成 PDF 文件
    ├── 写入 reports 表
    └── 返回 {"id": ..., "path": "report_xxx.pdf"}
```

### 性能注意事项

- SHAP 计算（第6章）是最慢的步骤，取样 ≤ 200 行
- 12章完整版生成时间通常 10-30 秒（视 SHAP 计算量）
- 管理层简报版不含 SHAP，通常 3-8 秒

---

## 七、PDF 查看与下载

### 前端 PDF 预览

- `GET /api/reports/{id}/download` 返回 PDF 文件流
- 前端使用 `PDFViewer` 组件（基于 `pdfjs-dist`）在模态框内嵌预览
- 支持全屏模式、页码导航、缩放

### 旧版向后兼容

旧版的 `include_sections` 参数（11个自由配置节）仍然支持，通过 API 传入时自动走旧版渲染路径：

```json
{
  "model_id": 5,
  "include_sections": ["executive_summary", "evaluation", "shap"]
}
```

---

## 八、报告解读指南

详细的报告结论解读方法，见 [`docs/guides/report-interpretation.md`](../guides/report-interpretation.md)。

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.5.0 | 全文「版本对应」与产品 v0.5.x 对齐；报告生成主路径无破坏性变更 |
| v0.4.x | §四数据来源补充 `preprocessing_log_json` / 预处理审计与质量分口径说明；链至 Wiki `09`；PDF `data_relations` 增加质量口径固定短文 |
| v0.3.0 | G3-C：report_service 重构为12章 + 4种模板 + BrandConfig schema；Report 页面新增模板选择 + 品牌定制面板；reportSections.ts 更新为 CHAPTERS_12 + REPORT_TEMPLATES |
| v0.2.0 | I3 报告增强：章节选择、模板管理（保存/加载）、APA 格式、data-narrative（G2-R1）落地 |
| v0.1.0 | 基础 PDF 报告框架（ReportLab + 中文字体跨平台支持）落地 |
