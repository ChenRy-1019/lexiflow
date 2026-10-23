//! Tests for the vocabulary store.

use lexiflow_lib::testing::Lexicon;

fn sample_lexicon() -> &'static str {
    r#"{
        "books": {
            "cet4": [
                {
                    "id": "cet4:abandon",
                    "word": "abandon",
                    "meaning": "放弃；抛弃",
                    "pos": "v.",
                    "phonetic": "ə'bændən",
                    "example": "",
                    "exampleZh": "",
                    "phrase": false,
                    "etymology": ""
                }
            ],
            "phrases": [
                {
                    "id": "phrases:a-bill-of-fare",
                    "word": "a bill of fare",
                    "meaning": "菜单",
                    "pos": "词组",
                    "phonetic": "",
                    "example": "",
                    "exampleZh": "",
                    "phrase": true,
                    "etymology": ""
                }
            ]
        },
        "meta": {
            "cet4": {
                "id": "cet4",
                "name": "四级词汇",
                "category": "国内考试",
                "short": "CET-4",
                "description": "四级大纲词汇",
                "total": 0
            },
            "phrases": {
                "id": "phrases",
                "name": "常用词组",
                "category": "国内考试",
                "short": "CET-4",
                "description": "四级词组",
                "total": 0
            }
        }
    }"#
}

#[test]
fn loads_books_and_entries() {
    let lexicon = Lexicon::from_json(sample_lexicon()).unwrap();
    assert_eq!(lexicon.books().len(), 2);
    assert_eq!(lexicon.total_entries(), 2);
    assert_eq!(lexicon.book_entries("cet4").len(), 1);

    let entry = lexicon.entry("cet4:abandon").unwrap();
    assert_eq!(entry.word, "abandon");
    assert!(!entry.phrase);
}

#[test]
fn resolves_a_list_of_ids_and_skips_unknown_ones() {
    let lexicon = Lexicon::from_json(sample_lexicon()).unwrap();
    let ids = vec![
        "cet4:abandon".to_string(),
        "does-not-exist".to_string(),
        "phrases:a-bill-of-fare".to_string(),
    ];
    let resolved = lexicon.resolve(&ids);
    assert_eq!(resolved.len(), 2);
    assert_eq!(resolved[0].word, "abandon");
    assert_eq!(resolved[1].word, "a bill of fare");
}

#[test]
fn search_matches_headwords_and_glosses() {
    let lexicon = Lexicon::from_json(sample_lexicon()).unwrap();

    let by_word = lexicon.search("aband", 10);
    assert_eq!(by_word.len(), 1);
    assert_eq!(by_word[0].word, "abandon");

    let by_gloss = lexicon.search("菜单", 10);
    assert_eq!(by_gloss.len(), 1);
    assert_eq!(by_gloss[0].word, "a bill of fare");

    assert!(lexicon.search("", 10).is_empty());
}

#[test]
fn metadata_totals_are_filled_in_from_the_entries() {
    let lexicon = Lexicon::from_json(sample_lexicon()).unwrap();
    let book = lexicon.books().iter().find(|b| b.id == "cet4").unwrap();
    assert_eq!(book.total, 1);
}
