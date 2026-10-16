pub mod encoding;
pub mod eol;
pub mod sniff;

pub use encoding::{Confidence, Detected, Unmappable};
pub use eol::{Eol, EolInfo};
pub use sniff::DocKind;
