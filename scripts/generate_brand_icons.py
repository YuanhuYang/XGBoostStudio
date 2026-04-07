# -*- coding: utf-8 -*-
"""
生成 XGBoost Studio 品牌应用图标：client/build/icon.png、icon.ico。
依赖：matplotlib（与 server 环境一致）、Pillow（ICO 多尺寸）。
用法（仓库根目录）:
  cd server && uv run --with pillow python ../scripts/generate_brand_icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402


def _draw_icon_png(path: Path, size: int = 512) -> None:
    """绘制圆角底 + 决策树意象 + 品牌色（青绿主色，贴近 XGBoost / 数据科学气质）。"""
    fig = plt.figure(figsize=(size / 96, size / 96), dpi=96)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("#0d9488")
    ax.set_facecolor("#0d9488")

    # 轻微径向渐变感（用 imshow）
    yy, xx = np.mgrid[0:1:256j, 0:1:256j]
    cx, cy = 0.35, 0.65
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    grad = np.clip(1.0 - r * 1.1, 0, 1)
    ax.imshow(grad, extent=(0, 1, 0, 1), origin="lower", cmap="Greens", alpha=0.25, zorder=0)

    # 圆角矩形底板
    from matplotlib.patches import FancyBboxPatch

    pad = 0.08
    box = FancyBboxPatch(
        (pad, pad),
        1 - 2 * pad,
        1 - 2 * pad,
        boxstyle="round,pad=0.02,rounding_size=0.12",
        facecolor="#0f766e",
        edgecolor="#99f6e4",
        linewidth=size / 128,
        zorder=1,
    )
    ax.add_patch(box)

    # 简化的二叉树（圆点 + 线）
    z = 2
    nodes = [
        (0.5, 0.62),
        (0.34, 0.38),
        (0.66, 0.38),
        (0.22, 0.2),
        (0.46, 0.2),
        (0.54, 0.2),
        (0.78, 0.2),
    ]
    edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]
    for a, b in edges:
        ax.plot(
            [nodes[a][0], nodes[b][0]],
            [nodes[a][1], nodes[b][1]],
            color="#ccfbf1",
            linewidth=size / 200,
            solid_capstyle="round",
            zorder=z,
        )
    for x, y in nodes:
        circ = plt.Circle((x, y), 0.045, color="#f0fdfa", ec="#14b8a6", linewidth=size / 256, zorder=z + 1)
        ax.add_patch(circ)

    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format="png", dpi=size / (fig.get_figwidth()), facecolor=fig.get_facecolor())
    plt.close(fig)


def _write_ico(png_path: Path, ico_path: Path) -> None:
    from PIL import Image

    img = Image.open(png_path).convert("RGBA")
    sizes = [256, 128, 64, 48, 32, 24, 16]
    frames = [img.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    frames[0].save(
        ico_path,
        format="ICO",
        sizes=[(f.width, f.height) for f in frames],
        append_images=frames[1:],
    )


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "client" / "build"
    png_path = out_dir / "icon.png"
    ico_path = out_dir / "icon.ico"
    try:
        _draw_icon_png(png_path, 512)
        _write_ico(png_path, ico_path)
    except ImportError as e:
        print("缺少依赖，请在 server 目录执行: uv run --with pillow python ../scripts/generate_brand_icons.py", file=sys.stderr)
        print(e, file=sys.stderr)
        return 1
    print(f"已写入: {png_path}\n已写入: {ico_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
