param(
    [string]$Db = "$env:APPDATA\app.lexiflow.desktop\lexiflow.db"
)

<#
.SYNOPSIS
    Verify the review pipeline against a real database.

.DESCRIPTION
    The desktop UI is awkward to drive from a script because the frameless
    window fights the window manager. This script instead checks the state
    that a completed review is supposed to leave behind, so a regression in
    the write path shows up even when the UI cannot be clicked.
#>

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Db)) {
    Write-Host "no database at $Db" -ForegroundColor Yellow
    Write-Host "start the application and answer one word first"
    exit 0
}

$python = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}

if (-not $python) {
    Write-Host "python not found; cannot inspect the database" -ForegroundColor Yellow
    exit 0
}

$script = @"
import json
import os
import sqlite3

path = os.environ["LEXIFLOW_DB"]
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row

cards = conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"]
logs = conn.execute("SELECT COUNT(*) AS n FROM review_logs").fetchone()["n"]
notes = conn.execute("SELECT COUNT(*) AS n FROM notebook").fetchone()["n"]

print(f"cards: {cards}")
print(f"review logs: {logs}")
print(f"notebook: {notes}")
print()

for row in conn.execute(
    "SELECT entry_id, card, state, due, correct_count, lapse_count, mastered "
    "FROM cards ORDER BY last_seen_at DESC LIMIT 5"
):
    card = json.loads(row["card"]) if row["card"] else None
    print(f"{row['entry_id']}")
    print(f"   state={row['state']} correct={row['correct_count']} lapse={row['lapse_count']} mastered={row['mastered']}")
    if card:
        print(f"   stability={card['stability']:.2f} difficulty={card['difficulty']:.2f} reps={card['reps']}")
        print(f"   due in {(row['due'] - card['lastReview']) / 86400000:.2f} days")

print()
for row in conn.execute(
    "SELECT entry_id, rating, mode, duration_ms FROM review_logs ORDER BY at DESC LIMIT 5"
):
    print(f"log: {row['entry_id']} rating={row['rating']} mode={row['mode']} {row['duration_ms']}ms")
"@

$env:LEXIFLOW_DB = $Db
$script | & $python -
