"""Audit every command for imported-word support.

The blocking bugs so far were all the same shape: one lookup path still read
only the bundled lexicon, so an imported word failed there. This scans each
command and reports which ones can see imported entries.
"""

from __future__ import annotations

import re
from pathlib import Path

LIB = Path("src-tauri/src/lib.rs")
src = LIB.read_text(encoding="utf-8")

# Split the file into command functions.
commands: list[tuple[str, str]] = []
pattern = re.compile(r"#\[tauri::command\]\s*fn\s+(\w+)\s*\(")
matches = list(pattern.finditer(src))

for index, match in enumerate(matches):
    name = match.group(1)
    end = matches[index + 1].start() if index + 1 < len(matches) else len(src)
    body = src[match.start() : end]
    commands.append((name, body))

print(f"commands: {len(commands)}\n")

# A command supports imported words when it goes through the shared resolver,
# or reads custom_* from the database.
SHARED = ("resolve_any(", "resolve_one(")
CUSTOM = ("custom_entries", "custom_books", "all_custom_entries", "custom_entries_by_ids")

print(f"{'command':<26} {'imported-aware':<16} how")
print("-" * 70)
unaware: list[str] = []

for name, body in commands:
    shared = any(token in body for token in SHARED)
    custom = any(token in body for token in CUSTOM)
    if shared or custom:
        how = "resolver" if shared else "db"
        print(f"{name:<26} {'yes':<16} {how}")
    else:
        # Commands that only touch settings, audio or cards do not need the
        # lexicon at all; list them separately so the report stays accurate.
        touches_lexicon = "lexicon." in body or "entry_id" in body
        if touches_lexicon:
            print(f"{name:<26} {'NO':<16} <- needs review")
            unaware.append(name)
        else:
            print(f"{name:<26} {'n/a':<16} (no lexicon use)")

print()
if unaware:
    print("commands that use the lexicon but cannot see imported words:")
    for name in unaware:
        print(f"  - {name}")
else:
    print("every lexicon-using command can see imported words")
