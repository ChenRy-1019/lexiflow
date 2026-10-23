//! Error types shared by the whole backend.

use serde::{Serialize, Serializer};

/// Everything that can go wrong inside the application.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("vocabulary error: {0}")]
    Vocabulary(String),
    #[error("{0}")]
    Other(String),
    #[error("audio error: {0}")]
    Audio(String),
}

/// Convenience alias for fallible backend operations.
pub type AppResult<T> = Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::Io(value.to_string())
    }
}

/// Serialise errors for the frontend so it can show a readable message.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
