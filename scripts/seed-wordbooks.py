"""Import the syllabus wordbooks straight into the running database.

The application's own import dialog does the same thing; this seeds the two
wordbooks so they are available immediately. It reads the generated CSV with
the same rules the backend uses: the word column, the gloss column, and the
phonetic column.

Usage:
    python scripts/seed-wordbooks.py
"""

from __future__ import annotations

import csv
import os
import sqlite3
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.expandvars(r"%APPDATA%\app.lexiflow.desktop\lexiflow.db")

BOOKS = [
    ("cet4", "四级大纲词汇（4540 词）", "cet4-syllabus.csv"),
    ("cet6", "六级大纲词汇（2220 词）", "cet6-syllabus.csv"),
]


def import_book(conn: sqlite3.Connection, label: str, name: str, filename: str) -> None:
    path = os.path.join(ROOT, "data", "wordbooks", filename)
    if not os.path.exists(path):
        print(f"{label}: missing {path}, run scripts/make-cet4-csv.py first")
        return

    # Skip a book that is already there, so running twice is harmless.
    existing = conn.execute(
        "SELECT id FROM custom_books WHERE name = ?", (name,)
    ).fetchone()
    if existing:
        print(f"{label}: already imported as {existing[0]}")
        return

    book_id = f"import-{label}-{int(time.time() * 1000)}"
    now = int(time.time() * 1000)

    rows: list[tuple[str, str, str, str, str]] = []
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, None)
        # Columns: 单词, 释义, 音标
        for index, row in enumerate(reader):
            if len(row) < 2:
                continue
            word = row[0].strip()
            meaning = row[1].strip() if len(row) > 1 else ""
            phonetic = row[2].strip() if len(row) > 2 else ""
            if not word:
                continue
            rows.append((f"{book_id}-{index}", word, meaning, phonetic, ""))

    conn.execute(
        "INSERT INTO custom_books (id, name, source, format, imported_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (book_id, name, filename, "CSV", now),
    )
    conn.executemany(
        "INSERT INTO custom_entries "
        "(book_id, entry_id, position, word, meaning, phonetic, pos) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (book_id, entry_id, position, word, meaning, phonetic, pos)
            for position, (entry_id, word, meaning, phonetic, pos) in enumerate(rows)
        ],
    )
    conn.commit()
    print(f"{label}: imported {len(rows)} words as {book_id}")


def main() -> None:
    if not os.path.exists(DB):
        raise SystemExit(f"database not found at {DB}; start LexiFlow once first")

    conn = sqlite3.connect(DB)
    for label, name, filename in BOOKS:
        import_book(conn, label, name, filename)

    total = conn.execute("SELECT COUNT(*) FROM custom_entries").fetchone()[0]
    print(f"total imported entries: {total}")
    conn.close()


if __name__ == "__main__":
    main()
