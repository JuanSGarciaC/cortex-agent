import json
import sqlite3
import time
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, source TEXT, chars INTEGER, created_at REAL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'hecho',
  embedding BLOB NOT NULL, run_id INTEGER, created_at REAL
);
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY, title TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, conv_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at REAL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, conv_id INTEGER, status TEXT, model TEXT, question TEXT,
  steps INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0, started_at REAL, ended_at REAL, source TEXT DEFAULT 'chat'
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL,
  data TEXT NOT NULL, ts REAL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY, dataset TEXT, kind TEXT, summary TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS eval_results (
  id INTEGER PRIMARY KEY, eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id TEXT, passed INTEGER, scores TEXT, output TEXT
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with session() as conn:
        conn.executescript(SCHEMA)


def now() -> float:
    return time.time()


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)
