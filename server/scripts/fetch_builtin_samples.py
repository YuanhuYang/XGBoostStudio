#!/usr/bin/env python3
"""
生成/更新 server/tests/data 下的内置示例 CSV。

默认：依次尝试 OpenML 拉取 german_credit、bank_marketing、adult、credit_default；
      失败则对该集回退到离线合成（与 UCI 变量结构对齐，固定随机种子）。

--offline：跳过网络，breast_cancer / wine 从 sklearn 导出，其余四类为离线合成。

用法（在 server 目录）:
  uv run python scripts/fetch_builtin_samples.py
  uv run python scripts/fetch_builtin_samples.py --offline
  uv run python scripts/fetch_builtin_samples.py --refresh-uci-automobile
      # 尝试从公开 URL 覆盖 uci_automobile_price.csv（与 Plotly/UCI 镜像一致）
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

# UCI Automobile / 1985 Imports（带表头的社区常用 CSV，与官方 imports-85 同分布）
UCI_AUTOMOBILE_URLS = (
    "https://raw.githubusercontent.com/plotly/datasets/master/imports-85.csv",
)

SERVER_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = SERVER_ROOT / "tests" / "data"


def _rng() -> np.random.Generator:
    return np.random.default_rng(42)


def _export_sklearn_breast_cancer(path: Path) -> None:
    from sklearn.datasets import load_breast_cancer

    bundle = load_breast_cancer(as_frame=True)
    df = bundle.frame.copy()
    df.rename(columns={"target": "diagnosis"}, inplace=True)
    df.to_csv(path, index=False, encoding="utf-8")


def _export_sklearn_wine(path: Path) -> None:
    from sklearn.datasets import load_wine

    bundle = load_wine(as_frame=True)
    df = bundle.frame.copy()
    df.rename(columns={"target": "class"}, inplace=True)
    df.to_csv(path, index=False, encoding="utf-8")


def _synth_german_credit(path: Path) -> None:
    rng = _rng()
    n = 1000
    x = rng.integers(0, 10, size=(n, 24), dtype=np.int64)
    score = x[:, :10].sum(axis=1).astype(np.float64) - 0.35 * x[:, 10:].sum(axis=1)
    score += rng.normal(0.0, 4.0, n)
    y = (score > 32.0).astype(np.int64)
    cols = [f"attr_{i:02d}" for i in range(1, 25)] + ["class"]
    df = pd.DataFrame(np.column_stack([x, y]), columns=cols)
    df.to_csv(path, index=False, encoding="utf-8")


def _synth_bank_marketing(path: Path, n: int = 10_000) -> None:
    rng = _rng()
    jobs = [
        "admin", "technician", "services", "management", "retired",
        "blue-collar", "entrepreneur", "self-employed", "student", "unemployed",
    ]
    marital = ["married", "single", "divorced"]
    education = ["primary", "secondary", "tertiary", "unknown"]
    housing = ["yes", "no"]
    loan = ["yes", "no"]
    contact = ["unknown", "cellular", "telephone"]
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    poutcome = ["unknown", "failure", "other", "success"]

    y = rng.choice(["yes", "no"], size=n, p=[0.117, 0.883])
    duration = rng.integers(1, 2500, size=n)
    duration = np.where(y == "yes", duration + rng.integers(50, 400, size=n), duration)
    duration = np.clip(duration, 1, 4000)

    df = pd.DataFrame({
        "age": rng.integers(18, 95, size=n),
        "job": rng.choice(jobs, size=n),
        "marital": rng.choice(marital, size=n, p=[0.6, 0.28, 0.12]),
        "education": rng.choice(education, size=n, p=[0.15, 0.56, 0.27, 0.02]),
        "default": rng.choice(["yes", "no"], size=n, p=[0.02, 0.98]),
        "balance": rng.integers(-3500, 85000, size=n),
        "housing": rng.choice(housing, size=n, p=[0.56, 0.44]),
        "loan": rng.choice(loan, size=n, p=[0.14, 0.86]),
        "contact": rng.choice(contact, size=n, p=[0.3, 0.64, 0.06]),
        "day": rng.integers(1, 32, size=n),
        "month": rng.choice(month, size=n),
        "duration": duration,
        "campaign": rng.integers(1, 45, size=n),
        "pdays": rng.choice([-1] + list(range(1, 900)), size=n, p=[0.81] + [0.19 / 899] * 899),
        "previous": rng.integers(0, 8, size=n),
        "poutcome": rng.choice(poutcome, size=n, p=[0.82, 0.1, 0.05, 0.03]),
        "y": y,
    })
    df.to_csv(path, index=False, encoding="utf-8")


def _synth_adult_income(path: Path, n: int = 10_000) -> None:
    rng = _rng()
    workclass = ["Private", "Self-emp-not-inc", "Local-gov", "State-gov", "Federal-gov", "Without-pay"]
    education = ["HS-grad", "Some-college", "Bachelors", "Masters", "Assoc-voc", "Doctorate", "11th", "9th"]
    marital = ["Married-civ-spouse", "Never-married", "Divorced", "Separated", "Widowed"]
    occupation = ["Prof-specialty", "Craft-repair", "Exec-managerial", "Adm-clerical", "Sales", "Other-service"]
    relationship = ["Husband", "Wife", "Not-in-family", "Own-child", "Unmarried"]
    race = ["White", "Black", "Asian-Pac-Islander", "Amer-Indian-Eskimo", "Other"]
    sex = ["Male", "Female"]
    native_country = ["United-States", "Mexico", "Philippines", "Germany", "Canada", "India", "China", "Other"]

    income = rng.choice(["<=50K", ">50K"], size=n, p=[0.76, 0.24])
    age = rng.integers(17, 90, size=n)
    education_num = np.clip((age // 6) + rng.integers(-2, 4, size=n), 1, 16)
    education_num = np.where(income == ">50K", education_num + rng.integers(0, 3, size=n), education_num)
    education_num = np.clip(education_num, 1, 16)

    df = pd.DataFrame({
        "age": age,
        "workclass": rng.choice(workclass, size=n),
        "fnlwgt": rng.integers(10_000, 1_500_000, size=n),
        "education": rng.choice(education, size=n),
        "education_num": education_num,
        "marital_status": rng.choice(marital, size=n),
        "occupation": rng.choice(occupation, size=n),
        "relationship": rng.choice(relationship, size=n),
        "race": rng.choice(race, size=n, p=[0.85, 0.1, 0.03, 0.01, 0.01]),
        "sex": rng.choice(sex, size=n, p=[0.67, 0.33]),
        "capital_gain": rng.integers(0, 100_000, size=n),
        "capital_loss": rng.integers(0, 4500, size=n),
        "hours_per_week": rng.integers(1, 100, size=n),
        "native_country": rng.choice(native_country, size=n, p=[0.89, 0.02, 0.02, 0.01, 0.01, 0.02, 0.01, 0.02]),
        "income": income,
    })
    df.to_csv(path, index=False, encoding="utf-8")


def _synth_credit_card_default(path: Path, n: int = 12_000) -> None:
    rng = _rng()
    pay_levels = np.arange(-2, 9)
    bill = rng.integers(-120_000, 320_000, size=(n, 6))
    pay_amt = rng.integers(0, 65_000, size=(n, 6))
    limit_bal = rng.integers(10_000, 500_000, size=n)
    pay0 = rng.choice(pay_levels, size=n).astype(np.float64)
    risk = (
        -0.000015 * limit_bal.astype(np.float64)
        + rng.normal(0, 0.35, n)
        + pay0 * 0.08
    )
    y = (risk + rng.normal(0, 0.25, n) > 0.15).astype(np.int64)

    rows = {
        "limit_bal": limit_bal,
        "sex": rng.integers(1, 3, size=n),
        "education": rng.integers(1, 7, size=n),
        "marriage": rng.integers(1, 4, size=n),
        "age": rng.integers(20, 80, size=n),
    }
    for i in range(6):
        rows[f"pay_{i}"] = rng.choice(pay_levels, size=n)
    for i in range(6):
        rows[f"bill_amt{i + 1}"] = bill[:, i]
    for i in range(6):
        rows[f"pay_amt{i + 1}"] = pay_amt[:, i]
    rows["default_payment_next_month"] = y

    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8")


def _synth_manufacturing_assembly_price(path: Path, n: int = 8_000) -> None:
    """制造业组装场景：零部件成本 + 产线/认证/批量等 → 成品单价（演示用合成数据，固定种子）。"""
    rng = _rng()
    lines = [f"LINE_{i:02d}" for i in range(1, 13)]
    tier = ["standard", "premium", "industrial"]
    cert = ["none", "CE", "UL", "ISO13485", "ATEX"]
    region = ["Asia", "EU", "NA", "Domestic"]

    chassis_cost = np.round(rng.uniform(4.5, 240.0, n), 2)
    pcb_module_cost = np.round(rng.uniform(6.0, 520.0, n), 2)
    mechanical_cost = np.round(rng.uniform(2.5, 195.0, n), 2)
    packaging_cost = np.round(rng.uniform(0.4, 52.0, n), 2)
    labor_minutes = rng.integers(15, 520, size=n)
    scrap_rate_pct = np.round(rng.uniform(0.15, 9.5, n), 2)
    batch_size = rng.integers(80, 8000, size=n)
    bom_distinct_parts = rng.integers(4, 140, size=n)
    assembly_line = rng.choice(lines, size=n)
    product_tier = rng.choice(tier, size=n, p=[0.52, 0.30, 0.18])
    certification = rng.choice(cert, size=n, p=[0.22, 0.24, 0.22, 0.18, 0.14])
    supplier_region = rng.choice(region, size=n, p=[0.42, 0.22, 0.20, 0.16])
    assembly_complexity = rng.integers(1, 11, size=n)

    material_stackup_layers = rng.integers(2, 18, size=n)
    tooling_amort_per_unit = np.round(rng.uniform(0.0, 35.0, n), 2)

    base = (
        chassis_cost
        + pcb_module_cost
        + mechanical_cost
        + packaging_cost
        + 0.38 * labor_minutes.astype(np.float64)
        + 11.5 * assembly_complexity.astype(np.float64)
        + 2.1 * material_stackup_layers.astype(np.float64)
        + tooling_amort_per_unit
        - 0.65 * np.sqrt(batch_size.astype(np.float64))
        + 0.08 * bom_distinct_parts.astype(np.float64)
    )
    base = base + np.where(product_tier == "premium", rng.uniform(35, 95, n), 0.0)
    base = base + np.where(product_tier == "industrial", rng.uniform(18, 55, n), 0.0)
    base = base + np.where(
        certification == "none",
        0.0,
        rng.uniform(12.0, 135.0, n),
    )
    region_mul = np.ones(n)
    region_mul = np.where(supplier_region == "EU", 1.09, region_mul)
    region_mul = np.where(supplier_region == "NA", 1.05, region_mul)
    region_mul = np.where(supplier_region == "Asia", 0.93, region_mul)

    noise = rng.lognormal(0.0, 0.11, n)
    finished = base * region_mul * (1.0 + 0.012 * scrap_rate_pct) * noise
    finished = np.round(np.clip(finished, 25.0, 28_000.0), 2)

    df = pd.DataFrame(
        {
            "chassis_component_cost": chassis_cost,
            "pcb_module_cost": pcb_module_cost,
            "mechanical_parts_cost": mechanical_cost,
            "packaging_cost": packaging_cost,
            "labor_minutes": labor_minutes,
            "scrap_rate_pct": scrap_rate_pct,
            "batch_size": batch_size,
            "bom_distinct_parts": bom_distinct_parts,
            "assembly_line": assembly_line,
            "product_tier": product_tier,
            "certification": certification,
            "supplier_region": supplier_region,
            "assembly_complexity_1_10": assembly_complexity,
            "pcb_layer_count": material_stackup_layers,
            "tooling_amort_per_unit": tooling_amort_per_unit,
            "finished_unit_price": finished,
        }
    )
    df.to_csv(path, index=False, encoding="utf-8")


def _try_openml_to_csv(data_id: int, path: Path, target_name: str | None = None) -> bool:
    try:
        from sklearn.datasets import fetch_openml

        bunch = fetch_openml(data_id=data_id, as_frame=True, parser="auto")
        x = bunch.data.copy()
        y = bunch.target
        ycol = target_name or (
            str(y.name) if hasattr(y, "name") and y.name else "target"
        )
        x[ycol] = y
        x.to_csv(path, index=False, encoding="utf-8")
        return True
    except Exception:
        return False


def _try_download_uci_automobile(path: Path) -> bool:
    """从公开镜像下载 UCI imports-85（首选带表头 CSV）。成功则写入 path。"""
    for url in UCI_AUTOMOBILE_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "XGBoostStudio-fetch-script/1"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            if b"symboling" in raw[:2000] or b"," in raw[:200]:
                path.write_bytes(raw)
                print(f"wrote {path.name} from {url}")
                return True
        except OSError:
            continue
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="不访问网络，全部离线生成")
    parser.add_argument(
        "--refresh-uci-automobile",
        action="store_true",
        help="联网并尝试覆盖 tests/data/uci_automobile_price.csv（失败则保留仓库内文件）",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.refresh_uci_automobile and not args.offline:
        ok = _try_download_uci_automobile(OUT_DIR / "uci_automobile_price.csv")
        if not ok:
            print("warning: could not refresh uci_automobile_price.csv from network; keeping existing file")

    # sklearn 随包数据（真实）
    _export_sklearn_breast_cancer(OUT_DIR / "breast_cancer.csv")
    print("wrote breast_cancer.csv (scikit-learn)")
    _export_sklearn_wine(OUT_DIR / "wine.csv")
    print("wrote wine.csv (scikit-learn)")

    _synth_manufacturing_assembly_price(OUT_DIR / "manufacturing_assembly_price.csv")
    print("wrote manufacturing_assembly_price.csv (synthetic manufacturing / assembly pricing)")

    specs = [
        ("german_credit.csv", lambda: _synth_german_credit(OUT_DIR / "german_credit.csv"), 31, "class"),
        ("bank_marketing.csv", lambda: _synth_bank_marketing(OUT_DIR / "bank_marketing.csv"), 42211, "y"),
        ("adult_income.csv", lambda: _synth_adult_income(OUT_DIR / "adult_income.csv"), 1590, "income"),
        ("credit_card_default.csv", lambda: _synth_credit_card_default(OUT_DIR / "credit_card_default.csv"), 42435, "default_payment_next_month"),
    ]

    for filename, fallback, oid, tcol in specs:
        path = OUT_DIR / filename
        ok = False
        if not args.offline:
            ok = _try_openml_to_csv(oid, path, target_name=tcol)
            if ok:
                print(f"wrote {filename} (OpenML data_id={oid})")
        if not ok:
            fallback()
            print(f"wrote {filename} (offline synthetic fallback)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
