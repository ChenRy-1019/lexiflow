"""Convert the open CET-4 wordbook into a CSV LexiFlow can import.

The source is `Box611/wordrush` (MIT), whose CET-4 list derives from the
published exam syllabus via `mahavivo/english-wordlists`. The syllabus is the
official word list for the exam, so the vocabulary itself is not a
publisher's editorial work; the glosses are the ones that repository
compiled.

Usage:
    python scripts/make-cet4-csv.py
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "cet4": ROOT / "data" / "_upstream" / "wordbook-cet4.js",
    "cet6": ROOT / "data" / "_upstream" / "wordbook-cet6.js",
}
OUT_DIR = ROOT / "data" / "wordbooks"


def load_items(path: Path) -> list[list[str]]:
    """Read the `items: [...]` array out of the wordbook script.

    The file is JavaScript, not JSON, so the array is located and parsed as
    JSON: every entry is a plain array of strings.
    """
    text = path.read_text(encoding="utf-8")

    start = text.index("items: [")
    start = text.index("[", start)

    # Walk to the matching bracket, ignoring any inside strings.
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return parse_js_array(text[start : index + 1])

    raise ValueError("unterminated items array")


def parse_js_array(raw: str) -> list[list[str]]:
    """Parse the array literal, tolerating a trailing comma.

    The source is JavaScript, where a trailing comma before the closing
    bracket is legal but JSON rejects it.
    """
    cleaned = re.sub(r",\s*]$", "]", raw.rstrip())
    return json.loads(cleaned)


def clean_meaning(value: str) -> str:
    """Tidy a gloss without losing its content.

    The source has a few entries where a stray quote and comma slipped into
    the gloss, such as `", num.百，百个 n.许多"` for `hundred`. Stripping the
    leading and trailing punctuation recovers the intended text.
    """
    cleaned = " ".join(value.split())
    cleaned = cleaned.lstrip(" \"',\t")
    cleaned = cleaned.rstrip(" \"'")
    return cleaned.strip()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for label, source in SOURCES.items():
        if source.exists():
            convert(label, source, OUT_DIR)


def convert(label: str, source: Path, out_dir: Path) -> None:
    items = load_items(source)
    print(f"{label}: read {len(items)} entries")

    out = out_dir / f"{label}-syllabus.csv"

    kept = 0
    with open(out, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["单词", "释义", "音标"])

        seen: set[str] = set()
        for row in items:
            word = row[0].strip()
            meaning = clean_meaning(row[1]) if len(row) > 1 else ""
            phonetic = row[2].strip() if len(row) > 2 else ""

            if not word or not re.search(r"[A-Za-z]", word):
                continue
            # A word repeated in the syllabus would become two cards.
            key = word.lower()
            if key in seen:
                continue
            seen.add(key)

            writer.writerow([word, meaning, phonetic])
            kept += 1

    print(f"wrote {kept} words to {out}")

    # The counts matter: the learner should know how much of the list is usable.
    with_meaning = sum(1 for row in items if len(row) > 1 and row[1].strip())
    with_phonetic = sum(1 for row in items if len(row) > 2 and row[2].strip())
    print(f"  with a gloss:    {with_meaning}")
    print(f"  with a phonetic: {with_phonetic}")


if __name__ == "__main__":
    main()
