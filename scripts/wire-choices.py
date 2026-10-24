"""Make the choice question work for imported words."""

from pathlib import Path

path = Path("src-tauri/src/lib.rs")
src = path.read_text(encoding="utf-8")

old = """    let entry = state
        .lexicon
        .entry(&entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {entry_id}")))?;

    let mut pool: Vec<&Entry> = state
        .lexicon
        .book_entries(&book_id)
        .iter()
        .filter_map(|id| state.lexicon.entry(id))
        .filter(|candidate| candidate.phrase == entry.phrase)
        .collect();

    if pool.len() < 8 {
        pool = state
            .lexicon
            .books()
            .iter()
            .flat_map(|book| state.lexicon.book_entries(&book.id))
            .filter_map(|id| state.lexicon.entry(id))
            .filter(|candidate| candidate.phrase == entry.phrase && candidate.id != entry_id)
            .collect();
    }

    // Pick three random distractors from the pool.
    let mut distractors: Vec<&Entry> = pool
        .iter()
        .filter(|candidate| candidate.id != entry_id && candidate.meaning != entry.meaning)
        .copied()
        .collect();"""

new = """    let db = state.db.lock().map_err(|_| AppError::Other("database is poisoned".into()))?;

    let entry = resolve_one(&db, &state.lexicon, &entry_id)
        .ok_or_else(|| AppError::Vocabulary(format!("unknown entry {entry_id}")))?;

    // Prefer distractors from the same book, then widen to the whole
    // vocabulary. Both steps go through the shared lookup so an imported book
    // contributes distractors as readily as a bundled one.
    let mut pool: Vec<Entry> = {
        let bundled = state.lexicon.book_entries(&book_id);
        if !bundled.is_empty() {
            state.lexicon.resolve(bundled)
        } else {
            db.custom_entries(&book_id)?
                .into_iter()
                .map(|item| Entry {
                    id: item.entry_id,
                    word: item.word,
                    meaning: item.meaning,
                    pos: item.pos,
                    phonetic: item.phonetic,
                    example: String::new(),
                    example_zh: String::new(),
                    phrase: false,
                    etymology: String::new(),
                })
                .collect()
        }
    };
    pool.retain(|candidate| candidate.phrase == entry.phrase);

    if pool.len() < 8 {
        let mut all: Vec<String> = Vec::new();
        for book in state.lexicon.books() {
            all.extend(state.lexicon.book_entries(&book.id).iter().cloned());
        }
        for item in db.all_custom_entries()? {
            all.push(item.entry_id);
        }
        pool = resolve_any(&db, &state.lexicon, &all);
        pool.retain(|candidate| candidate.phrase == entry.phrase && candidate.id != entry_id);
    }

    // Pick three random distractors from the pool.
    let mut distractors: Vec<Entry> = pool
        .into_iter()
        .filter(|candidate| candidate.id != entry_id && candidate.meaning != entry.meaning)
        .collect();"""

if old in src:
    src = src.replace(old, new, 1)
    print("build_choices covers imports")
else:
    print("CHOICES ANCHOR NOT FOUND")

path.write_text(src, encoding="utf-8")
