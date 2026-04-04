"""检查数据库现有列"""
import sys
sys.path.insert(0, '.')
from db.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    tables = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).fetchall()
    for (tbl,) in tables:
        cols = conn.execute(text(f"PRAGMA table_info({tbl})")).fetchall()
        col_names = [c[1] for c in cols]
        print(f"\n{tbl}: {col_names}")
