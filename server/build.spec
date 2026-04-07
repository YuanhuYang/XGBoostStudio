# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 构建配置
输出：Windows 为 dist/xgboost-server.exe；macOS/Linux 为 dist/xgboost-server（无扩展名）。
"""
import os
import sys

block_cipher = None

# 与 Electron 桌面包共用的品牌图标（由 client/npm generate:icons 生成）
try:
    _spec_dir = os.path.dirname(os.path.abspath(SPEC))
except NameError:
    try:
        _spec_dir = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        _spec_dir = os.getcwd()
_client_build = os.path.normpath(os.path.join(_spec_dir, "..", "client", "build"))
if sys.platform == "win32":
    _brand_icon = os.path.join(_client_build, "icon.ico")
elif sys.platform == "darwin":
    _brand_icon = os.path.join(_client_build, "icon.icns")
else:
    _brand_icon = None
_exe_icon = _brand_icon if _brand_icon and os.path.isfile(_brand_icon) else None
# UPX 在 macOS 上易引发签名/稳定性问题；Linux 上亦先关闭以优先保证可运行。
_use_upx = sys.platform == 'win32'

# 收集所有需要的数据文件
added_files = [
    # xgboost 数据文件
    ('routers', 'routers'),
    ('services', 'services'),
    ('schemas', 'schemas'),
    ('db', 'db'),
    # 内置示例 CSV（import-sample 从 tests/data 读取；未打入则打包版会 404）
    ('tests/data', 'tests/data'),
]

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[],
    datas=added_files,
    hiddenimports=[
        # FastAPI / Starlette
        'fastapi',
        'fastapi.middleware.cors',
        'starlette',
        'starlette.middleware',
        'starlette.middleware.cors',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # SQLAlchemy
        'sqlalchemy',
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.orm',
        # 数据处理
        'pandas',
        'numpy',
        'scipy',
        'scipy.stats',
        'statsmodels',
        'sklearn',
        'sklearn.ensemble',
        'sklearn.linear_model',
        'sklearn.preprocessing',
        'sklearn.model_selection',
        'sklearn.metrics',
        # XGBoost
        'xgboost',
        # SHAP
        'shap',
        # Optuna
        'optuna',
        # 其他
        'openpyxl',
        'aiofiles',
        'multipart',
        'python_multipart',
        # 路由模块
        'routers',
        'routers.datasets',
        'routers.params',
        'routers.training',
        'routers.models',
        'routers.tuning',
        'routers.reports',
        'routers.prediction',
        # 数据库模块
        'db',
        'db.database',
        'db.models',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'tkinter',
        'PyQt5',
        'PyQt6',
        'wx',
        'IPython',
        'jupyter',
        'notebook',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='xgboost-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=_use_upx,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_exe_icon,
)
