"""Extract the CET-4 core wordbook from the docx into a CSV.

The document is ten tables, each headed 单词 / 音标 / 词性与释义, with one
entry per row.

A word can appear in more than one unit with a different sense — `content` as
"n. 内容" in one place and "adj. 满意的" in another. Dropping the repeat loses
a sense the learner needs, so repeats are merged into one row whose gloss
combines both.
"""

from __future__ import annotations

import csv
import io
import os
import re

from docx import Document

SOURCE = os.path.expanduser(
    r"C:\Users\Administrator\Documents\xwechat_files\wxid_ojfbphz4uvr522_ad36"
    r"\msg\file\2026-10\英语四级核心词.docx"
)
OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "wordbooks"
)
OUT = os.path.join(OUT_DIR, "cet4-core.csv")


def clean(value: str) -> str:
    """Collapse whitespace, including the ideographic space used in headers."""
    return " ".join(value.replace("\u3000", " ").split())


def main() -> None:
    doc = Document(SOURCE)

    # Preserve document order, accumulate glosses for repeats.
    order: list[str] = []
    merged: dict[str, dict[str, str]] = {}
    skipped = 0
    repeats = 0

    for table in doc.tables:
        for row in table.rows:
            cells = [clean(cell.text) for cell in row.cells]
            if len(cells) < 3:
                skipped += 1
                continue

            word, phonetic, meaning = cells[0], cells[1], cells[2]

            if not re.search(r"[A-Za-z]", word) or not meaning or len(word) > 40:
                skipped += 1
                continue

            key = word.lower()
            phonetic = phonetic.strip("/").strip()

            if key in merged:
                repeats += 1
                entry = merged[key]
                # Append the new sense only when it is not already present.
                if meaning not in entry["meaning"]:
                    entry["meaning"] = f"{entry['meaning']}；{meaning}"
                if not entry["phonetic"] and phonetic:
                    entry["phonetic"] = phonetic
                continue

            order.append(key)
            merged[key] = {
                "word": word,
                "meaning": meaning,
                "phonetic": phonetic,
            }

    rows = [
        (merged[key]["word"], merged[key]["meaning"], merged[key]["phonetic"])
        for key in order
    ]

    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["单词", "释义", "音标"])
        writer.writerows(rows)

    print(f"entries: {len(rows)}")
    print(f"merged repeats: {repeats}")
    print(f"skipped rows: {skipped}")
    print(f"with phonetic: {sum(1 for r in rows if r[2])}")
    print(f"written: {OUT}")

    sample = os.path.join(os.environ.get("TEMP", "."), "cet4-core-sample.txt")
    with io.open(sample, "w", encoding="utf-8") as handle:
        for word, meaning, phonetic in rows[:6]:
            handle.write(f"{word} | {phonetic} | {meaning}\n")
        # Show a merged entry, to prove the senses were combined.
        for key in ("content", "record", "impact"):
            if key in merged:
                entry = merged[key]
                handle.write(f"[merged] {entry['word']} | {entry['meaning']}\n")
    print("samples:", sample)


if __name__ == "__main__":
    main()
