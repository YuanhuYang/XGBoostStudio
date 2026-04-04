#!/usr/bin/env python3
"""
跨平台构建脚本 - 支持 Windows / macOS / Linux

用法:
    python scripts/build.py --server     # 构建后端
    python scripts/build.py --client     # 构建前端
    python scripts/build.py --all        # 全量构建
    python scripts/build.py --clean      # 清理构建产物

环境要求:
    - Python 3.8+
    - uv (后端依赖管理)
    - Node.js 16+ 和 npm (前端构建)
    - PyInstaller 6.19+ (Windows 后端构建)
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def get_root_dir() -> Path:
    """获取项目根目录"""
    return Path(__file__).parent.parent


def run_command(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    """执行命令并返回退出码"""
    print(f"[BUILD] 执行: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if check and result.returncode != 0:
        print(f"[ERROR] 命令失败，退出码: {result.returncode}")
        sys.exit(1)
    return result.returncode


def build_server(root_dir: Path) -> None:
    """构建后端服务"""
    print("\n" + "="*60)
    print("构建后端服务...")
    print("="*60)

    server_dir = root_dir / "server"

    # 1. 安装依赖
    print("\n[1/3] 安装依赖...")
    run_command(["uv", "sync"], cwd=server_dir)

    # 2. Windows 仅：使用 PyInstaller 生成 exe
    if sys.platform == "win32":
        print("\n[2/3] 使用 PyInstaller 构建 Windows exe...")
        run_command(
            ["uv", "run", "pyinstaller", "build.spec", "--noconfirm"],
            cwd=server_dir,
        )

        # 3. 复制到前端 resources 目录
        exe_source = server_dir / "dist" / "xgboost-server.exe"
        exe_dest = root_dir / "client" / "resources" / "xgboost-server.exe"
        if exe_source.exists():
            print(f"\n[3/3] 复制 exe 到 {exe_dest}...")
            exe_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(exe_source, exe_dest)
            print(f"✓ 后端构建完成: {exe_dest}")
        else:
            print(f"✗ 找不到 {exe_source}，跳过复制")
    else:
        print(
            "\n[2/3] 跳过 PyInstaller (仅 Windows 支持)\n"
            "[3/3] 后端依赖安装完成，可通过 `uv run python main.py` 启动"
        )


def build_client(root_dir: Path) -> None:
    """构建前端应用"""
    print("\n" + "="*60)
    print("构建前端应用...")
    print("="*60)

    client_dir = root_dir / "client"

    # 1. 安装依赖
    print("\n[1/3] 安装依赖...")
    run_command(["npm", "install"], cwd=client_dir)

    # 2. 编译 TypeScript + React
    print("\n[2/3] 构建 React...")
    run_command(["npm", "run", "build"], cwd=client_dir)

    # 3. 生成安装包
    print("\n[3/3] 生成应用（electron-builder）...")
    if sys.platform == "win32":
        run_command(["npm", "run", "build:installer"], cwd=client_dir)
        print("✓ Windows 安装包已生成到 dist/")
    elif sys.platform == "darwin":
        run_command(["npm", "run", "build:installer"], cwd=client_dir)
        print("✓ macOS DMG 已生成到 dist/")
    else:
        run_command(["npm", "run", "build:installer"], cwd=client_dir)
        print("✓ Linux AppImage 已生成到 dist/")


def build_all(root_dir: Path) -> None:
    """全量构建"""
    build_server(root_dir)
    build_client(root_dir)
    print("\n" + "="*60)
    print("✓ 全量构建完成！")
    print("="*60)


def clean(root_dir: Path) -> None:
    """清理构建产物"""
    print("\n" + "="*60)
    print("清理构建产物...")
    print("="*60)

    paths_to_clean = [
        root_dir / "server" / "dist",
        root_dir / "server" / "build",
        root_dir / "client" / "dist-electron",
        root_dir / "client" / "dist",
        root_dir / "dist",
    ]

    for path in paths_to_clean:
        if path.exists():
            print(f"删除: {path}")
            shutil.rmtree(path)

    print("✓ 清理完成")


def main():
    parser = argparse.ArgumentParser(
        description="XGBoost Studio 跨平台构建脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/build.py --server     # 仅构建后端
  python scripts/build.py --client     # 仅构建前端
  python scripts/build.py --all        # 全量构建
  python scripts/build.py --clean      # 清理产物
        """,
    )

    parser.add_argument(
        "--server",
        action="store_true",
        help="构建后端服务",
    )
    parser.add_argument(
        "--client",
        action="store_true",
        help="构建前端应用",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="全量构建（后端+前端）",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="清理构建产物",
    )

    args = parser.parse_args()

    root_dir = get_root_dir()

    if args.clean:
        clean(root_dir)
    elif args.all:
        build_all(root_dir)
    elif args.server:
        build_server(root_dir)
    elif args.client:
        build_client(root_dir)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
