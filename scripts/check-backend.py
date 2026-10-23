"""End-to-end check of the bundled lexicon.

Verifies that the generated file is internally consistent and that the
contents look like usable study material: every entry has a word and a
meaning, ids are unique within a book, and the exam books are large enough
to be worth shipping.

Run with:
    python scripts/check-backend.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "lexicon.json"


def main() -> int:
    if not DATA.exists():
        print(f"missing {DATA}; run `npm run lexicon:build` first")
        return 1

    payload = json.loads(DATA.read_text(encoding="utf-8"))
    books: dict[str, list[dict]] = payload["books"]
    meta: dict[str, dict] = payload["meta"]

    total = sum(len(entries) for entries in books.values())
    print(f"lexicon: {total} entries across {len(books)} books")
    print(f"source: {payload.get('source', {}).get('name')} ({payload.get('source', {}).get('license')})")
    print()

    problems = 0
    for book_id, entries in books.items():
        ids: set[str] = set()
        empty_meaning = 0
        with_pos = 0
        with_etymology = 0
        phrases = 0

        for entry in entries:
            if not entry.get("meaning"):
                empty_meaning += 1
            if not entry.get("word"):
                print(f"  empty word: {book_id}/{entry.get('id')}")
                problems += 1
            if entry["id"] in ids:
                print(f"  duplicate id: {entry['id']}")
                problems += 1
            ids.add(entry["id"])
            if entry.get("pos"):
                with_pos += 1
            if entry.get("etymology"):
                with_etymology += 1
            if entry.get("phrase"):
                phrases += 1

        name = meta.get(book_id, {}).get("name", book_id)
        print(f"  {book_id:14s} {len(entries):6d} entries  pos={with_pos:5d}  "
              f"etymology={with_etymology:5d}  phrases={phrases:4d}  {name}")

        if empty_meaning:
            print(f"    ! {empty_meaning} entries without a meaning")
            problems += empty_meaning

    print()

    # The exam books are the core of the product; they need to be usable.
    for required in ("cet4", "cet6", "kaoyan"):
        if required not in books:
            print(f"missing required book: {required}")
            problems += 1
        elif len(books[required]) < 1000:
            print(f"book {required} is too small: {len(books[required])} entries")
            problems += 1

    print(f"problems: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
