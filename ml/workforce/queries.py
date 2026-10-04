"""Requêtes partagées avec TypeScript (src/lib/ai/workforce/queries.json), même expansion des fragments."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUERIES_JSON = ROOT / "src" / "lib" / "ai" / "workforce" / "queries.json"

_SPEC = json.loads(QUERIES_JSON.read_text(encoding="utf-8"))
_DEPT_AT = re.compile(r"\{\{deptAt:([^}]+)\}\}")


def sql(name: str) -> str:
    text = "\n".join(_SPEC["queries"][name])
    ws = "\n".join(_SPEC["fragments"]["ws"])
    dept_at = "\n".join(_SPEC["fragments"]["deptAt"])
    text = text.replace("{{ws}}", ws)
    return _DEPT_AT.sub(lambda m: dept_at.replace("{d}", m.group(1)), text)


def rows(con: sqlite3.Connection, name: str, params: dict | None = None) -> list[dict]:
    cur = con.execute(sql(name), params or {})
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def connect_ro(db_path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
