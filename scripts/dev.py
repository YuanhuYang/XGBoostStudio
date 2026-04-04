#!/usr/bin/env python3
"""
跨平台开发启动脚本 - 支持 Windows / macOS / Linux

用法:
    python scripts/dev.py --server     # 启动后端服务（uv run python main.py）
    python scripts/dev.py --client     # 启动前端开发服务（npm run dev）
    python scripts/dev.py --all        # 同时启动后端和前端

环境要求:
    - Python 3.8+
    - uv (后端依赖管理)
    - Node.js 16+ 和 npm (前端开发)
"""

import argparse
import platform
import subprocess
import sys
from pathlib import Path


def get_platform_info() -> str:
    """返回当前平台与架构的可读描述"""
    system = platform.system()
    machine = platform.machine()
    if system == "Darwin":
        chip = "Apple Silicon (arm64)" if machine == "arm64" else "Intel (x86_64)"
        return f"macOS {chip}"
    if system == "Windows":
        return f"Windows ({machine})"
    return f"Linux ({machine})"


def get_root_dir() -> Path:
    """获取项目根目录"""
    return Path(__file__).parent.parent


def _client_npm_cmd() -> list[str]:
    """Linux 使用 dev:web（无 Electron），其他平台使用 dev（Electron）"""
    if sys.platform.startswith("linux"):
        return ["npm", "run", "dev:web"]
    return ["npm", "run", "dev"]


def start_server(root_dir: Path) -> None:
    """启动后端服务"""
    print("\n" + "="*60)
    print(f"平台: {get_platform_info()}")
    print("启动后端服务（FastAPI on http://127.0.0.1:18899）")
    print("="*60)
    print("按 Ctrl+C 停止服务\n")

    server_dir = root_dir / "server"
    subprocess.run(
        ["uv", "run", "python", "main.py"],
        cwd=server_dir,
        check=False,
    )


def start_client(root_dir: Path) -> None:
    """启动前端开发服务"""
    platform_info = get_platform_info()
    if sys.platform.startswith("linux"):
        mode = "Web 浏览器模式（http://localhost:5173）"
    else:
        mode = "Electron 窗口模式"
    print("\n" + "="*60)
    print(f"平台: {platform_info}")
    print(f"启动前端开发服务 — {mode}")
    print("="*60)
    print("按 Ctrl+C 停止服务\n")

    client_dir = root_dir / "client"
    subprocess.run(
        _client_npm_cmd(),
        cwd=client_dir,
        check=False,
    )


def start_all(root_dir: Path) -> None:
    """同时启动后端和前端"""
    print("\n" + "="*60)
    print(f"平台: {get_platform_info()}")
    print("启动完整开发环境...")
    print("="*60)
    print("""
开发流程:
  1. 后端服务: http://127.0.0.1:18899
  2. 前端服务: http://localhost:5173
  3. Electron:
     - Windows: npm run dev (from client/)
     - macOS/Linux: npm run dev (from client/)

按 Ctrl+C 停止所有服务（可能需要按两次）
    """)

    server_dir = root_dir / "server"
    client_dir = root_dir / "client"

    # 启动后端进程（不捕获输出，让日志直接显示在终端）
    server_proc = subprocess.Popen(
        ["uv", "run", "python", "main.py"],
        cwd=server_dir,
    )

    # 启动前端进程（Linux 使用 dev:web，无需 Electron）
    client_proc = subprocess.Popen(
        _client_npm_cmd(),
        cwd=client_dir,
    )

    try:
        print("\n✓ 后端和前端都已启动")
        print("  等待进程退出...")
        server_proc.wait()
        client_proc.wait()
    except KeyboardInterrupt:
        print("\n\n停止进程...")
        server_proc.terminate()
        client_proc.terminate()
        server_proc.wait(timeout=5)
        client_proc.wait(timeout=5)
        print("✓ 所有进程已停止")


def main():
    parser = argparse.ArgumentParser(
        description="XGBoost Studio 跨平台开发启动脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/dev.py --server     # 启动后端 (FastAPI)
  python scripts/dev.py --client     # 启动前端 (Vite)
  python scripts/dev.py --all        # 启动所有（后端+前端）
        """,
    )

    parser.add_argument(
        "--server",
        action="store_true",
        help="启动后端服务（FastAPI）",
    )
    parser.add_argument(
        "--client",
        action="store_true",
        help="启动前端开发服务（Vite）",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="同时启动后端和前端",
    )

    args = parser.parse_args()

    root_dir = get_root_dir()

    if args.all:
        start_all(root_dir)
    elif args.server:
        start_server(root_dir)
    elif args.client:
        start_client(root_dir)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
