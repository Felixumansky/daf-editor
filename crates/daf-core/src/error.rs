use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorCode {
    NotFound,
    PermissionDenied,
    NotGranted,
    Conflict,
    Unmappable,
    Binary,
    TooLarge,
    ReadOnly,
    Io,
    Invalid,
    Cancelled,
}

/// The error type every IPC command returns. Serialized as `{ code, message }`.
#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[error("{code:?}: {message}")]
pub struct DafError {
    pub code: ErrorCode,
    pub message: String,
}

impl DafError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for DafError {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::Io,
        };
        Self::new(code, e.to_string())
    }
}

impl From<serde_json::Error> for DafError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(ErrorCode::Invalid, e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DafError>;
