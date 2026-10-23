//! Word pronunciation.
//!
//! Two sources are available, and the application falls back from one to the
//! other:
//!
//! 1. **Online recordings** from Youdao's dictionary service. These are real
//!    human recordings, so they sound natural, but they need a network
//!    connection the first time a word is played.
//! 2. **The system voice** installed on the machine. This always works, but
//!    it is a synthesiser, so it sounds flatter than a recording.
//!
//! Downloaded audio is cached on disk, keyed by the word and the accent, so
//! a word is only fetched once.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Which accent to pronounce a word in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    /// American English.
    Us,
    /// British English.
    Uk,
}

impl Accent {
    /// The name used in the settings and the cache key.
    pub fn as_str(&self) -> &'static str {
        match self {
            Accent::Us => "us",
            Accent::Uk => "uk",
        }
    }

    /// Parse the accent name used by the frontend.
    pub fn parse(value: &str) -> Accent {
        match value {
            "uk" => Accent::Uk,
            _ => Accent::Us,
        }
    }

    /// The numeric variant the online service expects: 1 is British, 2 is
    /// American.
    fn variant(&self) -> u8 {
        match self {
            Accent::Uk => 1,
            Accent::Us => 2,
        }
    }
}

/// The outcome of a pronunciation request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Pronunciation {
    /// A cached recording is ready to play.
    Cached {
        /// The recording, base64 encoded.
        data: String,
    },
    /// The system voice should speak the word.
    System {
        /// The text to speak.
        text: String,
    },
}

/// The cache of downloaded recordings.
pub struct AudioCache {
    root: PathBuf,
    client: ureq::Agent,
}

impl AudioCache {
    /// Open (or create) the cache directory.
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);

        let client = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(4))
            .timeout_read(std::time::Duration::from_secs(6))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build();

        AudioCache { root, client }
    }

    /// The directory holding the cached recordings.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The file a word is cached in.
    ///
    /// The key is a hash of the accent and the word, so any punctuation is
    /// safe in a file name and different accents never collide.
    fn path_for(&self, word: &str, accent: Accent) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(accent.as_str().as_bytes());
        hasher.update(b":");
        hasher.update(word.trim().to_lowercase().as_bytes());
        let digest = hasher.finalize();
        let name = digest
            .iter()
            .take(16)
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.root.join(format!("{name}.mp3"))
    }

    /// Whether a word is already cached.
    pub fn is_cached(&self, word: &str, accent: Accent) -> bool {
        let path = self.path_for(word, accent);
        // A very small file is an error page rather than an audio recording.
        match std::fs::metadata(&path) {
            Ok(meta) => meta.len() > 800,
            Err(_) => false,
        }
    }

    /// Fetch a recording and store it in the cache.
    ///
    /// Returns the path of the cached file. An error means the caller should
    /// fall back to the system voice.
    pub fn fetch(&self, word: &str, accent: Accent) -> AppResult<PathBuf> {
        let trimmed = word.trim();
        if trimmed.is_empty() {
            return Err(AppError::Audio("nothing to pronounce".into()));
        }

        let path = self.path_for(trimmed, accent);
        if self.is_cached(trimmed, accent) {
            return Ok(path);
        }

        let url = format!(
            "https://dict.youdao.com/dictvoice?audio={}&type={}",
            encode_query(trimmed),
            accent.variant()
        );

        let response = self
            .client
            .get(&url)
            .call()
            .map_err(|err| AppError::Audio(format!("pronunciation service unreachable: {err}")))?;

        let mut body = Vec::new();
        std::io::Read::read_to_end(&mut response.into_reader(), &mut body)
            .map_err(|err| AppError::Audio(format!("cannot read the recording: {err}")))?;

        // The service answers with an empty body or an error page when it has
        // no recording for a word.
        if body.len() < 800 {
            return Err(AppError::Audio("no recording available".into()));
        }

        std::fs::write(&path, &body)?;
        Ok(path)
    }

    /// Remove every cached recording.
    pub fn clear(&self) -> AppResult<()> {
        if !self.root.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("mp3") {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(())
    }

    /// How many recordings are cached.
    pub fn count(&self) -> usize {
        match std::fs::read_dir(&self.root) {
            Ok(entries) => entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .is_some()
                })
                .count(),
            Err(_) => 0,
        }
    }

    /// How much space the cache occupies, in bytes.
    pub fn size(&self) -> u64 {
        match std::fs::read_dir(&self.root) {
            Ok(entries) => entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| entry.metadata().ok())
                .map(|meta| meta.len())
                .sum(),
            Err(_) => 0,
        }
    }

    /// Read a recording and return it as base64.
    ///
    /// The web view cannot load a `file://` URL from the application origin,
    /// so the recording travels over IPC instead and the frontend turns it
    /// into a blob URL.
    pub fn read_base64(&self, path: &Path) -> AppResult<String> {
        // Only files inside the cache directory may be read, so the command
        // cannot be used to pull arbitrary files off the machine.
        let canonical = path.canonicalize().map_err(|err| {
            AppError::Audio(format!("cannot open the recording: {err}"))
        })?;
        let root = self
            .root
            .canonicalize()
            .map_err(|err| AppError::Audio(format!("cannot open the cache: {err}")))?;

        if !canonical.starts_with(&root) {
            return Err(AppError::Audio(
                "the recording is not in the cache directory".into(),
            ));
        }

        let bytes = std::fs::read(&canonical)?;
        Ok(base64_encode(&bytes))
    }
}

/// Encode bytes as standard base64.
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(ALPHABET[(triple >> 18) as usize & 0x3F] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 0x3F] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 0x3F] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 0x3F] as char
        } else {
            '='
        });
    }
    out
}

/// Percent-encode a word for use in a query string.
fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lexiflow-audio-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn accents_round_trip() {
        assert_eq!(Accent::parse("uk"), Accent::Uk);
        assert_eq!(Accent::parse("us"), Accent::Us);
        assert_eq!(Accent::parse("anything else"), Accent::Us);
        assert_eq!(Accent::Uk.as_str(), "uk");
        assert_eq!(Accent::Us.as_str(), "us");
    }

    #[test]
    fn the_cache_key_depends_on_the_word_and_the_accent() {
        let cache = AudioCache::new(temp_dir("keys"));
        let us = cache.path_for("abandon", Accent::Us);
        let uk = cache.path_for("abandon", Accent::Uk);
        let other = cache.path_for("abandon!", Accent::Us);

        assert_ne!(us, uk);
        assert_ne!(us, other);
        assert!(us.to_string_lossy().ends_with(".mp3"));
    }

    #[test]
    fn words_that_differ_only_in_case_share_a_cache_entry() {
        let cache = AudioCache::new(temp_dir("case"));
        assert_eq!(
            cache.path_for("Abandon", Accent::Us),
            cache.path_for("abandon", Accent::Us)
        );
    }

    #[test]
    fn an_empty_word_is_rejected() {
        let cache = AudioCache::new(temp_dir("empty"));
        let error = cache.fetch("   ", Accent::Us).unwrap_err();
        assert!(error.to_string().contains("nothing to pronounce"));
    }

    #[test]
    fn query_encoding_escapes_reserved_characters() {
        assert_eq!(encode_query("a bill of fare"), "a%20bill%20of%20fare");
        assert_eq!(encode_query("don't"), "don%27t");
        assert_eq!(encode_query("word&more"), "word%26more");
    }

    #[test]
    fn clearing_the_cache_removes_the_recordings() {
        let dir = temp_dir("clear");
        let cache = AudioCache::new(dir.clone());
        std::fs::write(cache.path_for("abandon", Accent::Us), b"x".repeat(2000)).unwrap();
        assert_eq!(cache.count(), 1);

        cache.clear().unwrap();
        assert_eq!(cache.count(), 0);
    }

    #[test]
    fn base64_matches_the_standard_encoding() {
        // The RFC 4648 test vectors.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn a_recording_outside_the_cache_cannot_be_read() {
        let dir = temp_dir("outside");
        let cache = AudioCache::new(dir.clone());

        let elsewhere = std::env::temp_dir().join(format!("lexiflow-outside-{}.mp3", std::process::id()));
        std::fs::write(&elsewhere, b"x".repeat(2000)).unwrap();

        let error = cache.read_base64(&elsewhere).unwrap_err();
        assert!(error.to_string().contains("not in the cache directory"));

        let _ = std::fs::remove_file(&elsewhere);
    }

    #[test]
    fn a_cached_recording_can_be_read_back() {
        let dir = temp_dir("read");
        let cache = AudioCache::new(dir.clone());
        let path = cache.path_for("abandon", Accent::Us);
        std::fs::write(&path, b"ID3 audio bytes").unwrap();

        let encoded = cache.read_base64(&path).unwrap();
        assert!(encoded.starts_with("SUQz"));
    }
}
