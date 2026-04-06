# 内置示例数据说明

## 随包真实数据（与公开基准一致或来自 sklearn 分发包）

| 文件 | 说明 |
|------|------|
| `titanic.csv` | Titanic 生存预测（经典二分类示例） |
| `iris.csv` | Iris 花种（多分类） |
| `boston_housing.csv` | Boston Housing 回归（教学用经典数据集；部分工具链已标注伦理争议，本仓库保留以兼容既有教程与测试） |
| `breast_cancer.csv` | 由 `scripts/fetch_builtin_samples.py` 从 **scikit-learn** 内置数据导出（Wisconsin Breast Cancer，BSD 许可随 sklearn） |
| `wine.csv` | 同上，来自 sklearn 内置 Wine recognition 数据集 |
| `uci_automobile_price.csv` | **UCI Machine Learning Repository — Automobile（1985 Imports）** 公开数据；本仓库副本带表头，与社区常用 `imports-85` 一致（如 [Plotly 镜像](https://raw.githubusercontent.com/plotly/datasets/master/imports-85.csv)）。 |

**官方与引用**

- 数据集页： [https://archive.ics.uci.edu/dataset/10/automobile](https://archive.ics.uci.edu/dataset/10/automobile)  
- **DOI**：`10.24432/C5BC74`（UCI 为该条目提供的 DOI）  
- 仓储总引用：Dua, D. and Graff, C. (2017). *UCI Machine Learning Repository* [http://archive.ics.uci.edu/ml]. Irvine, CA: University of California, School of Information and Computer Science.
- 原始数据常称 *1985 Auto Imports* / *imports-85*；亦在 Kaggle 等平台以「1985 Auto Imports」等形式转载（仍以 UCI 原始说明与许可为准）。

## 结构对齐 UCI/OpenML 的演示数据（离线合成）

以下文件在**无法访问 OpenML** 时由脚本以 **固定随机种子（42）** 生成，**列名与业务含义**对齐常见公开基准（German Credit、Bank Marketing、Adult、Default of Credit Card Clients），**行数据并非 UCI 逐条镜像**，用于安装包内离线演示与界面联调。若需原始基准数据，请至 [UCI Machine Learning Repository](https://archive.ics.uci.edu/) 或 [OpenML](https://www.openml.org/) 获取，并在可联网环境下运行：

```bash
cd server && uv run python scripts/fetch_builtin_samples.py
```

将尝试用 OpenML 覆盖对应 CSV。

| 文件 | 对应公开基准（变量结构） |
|------|--------------------------|
| `german_credit.csv` | Statlog German Credit Data（numeric 风格列） |
| `bank_marketing.csv` | Bank Marketing（UCI） |
| `adult_income.csv` | Adult / Census Income |
| `credit_card_default.csv` | Default of Credit Card Clients（台湾） |
| `manufacturing_assembly_price.csv` | 制造业组装定价演示（零部件成本、产线、认证、批量等 → `finished_unit_price`，**合成数据** seed=42） |
