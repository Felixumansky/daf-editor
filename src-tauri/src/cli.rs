//! Command-line files: `daf a.txt src/main.rs:120:5`.

use std::path::Path;

use crate::events::OpenRequest;

/// Turn process arguments into open requests. `argv[0]` is the executable; flags are ignored for now.
pub fn parse(argv: &[String], cwd: &Path) -> Vec<OpenRequest> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.is_empty())
        .filter_map(|arg| {
            let resolve = |p: &str| {
                let p = Path::new(p);
                if p.is_absolute() {
                    p.to_path_buf()
                } else {
                    cwd.join(p)
                }
            };
            let whole = resolve(arg);
            if whole.exists() {
                return Some(OpenRequest {
                    path: whole.to_string_lossy().into_owned(),
                    line: None,
                    col: None,
                });
            }
            // `file:line` or `file:line:col` (a drive letter's colon is part of the path).
            let mut parts = arg.rsplitn(3, ':');
            let last = parts.next()?;
            let mid = parts.next();
            let rest = parts.next();
            let (path, line, col) = match (rest, mid, last.parse::<u32>()) {
                (Some(p), Some(l), Ok(c)) if l.parse::<u32>().is_ok() => {
                    (p.to_string(), l.parse().ok(), Some(c))
                }
                (_, Some(_), Ok(l)) => {
                    (arg[..arg.len() - last.len() - 1].to_string(), Some(l), None)
                }
                _ => (arg.clone(), None, None),
            };
            let path = resolve(&path);
            Some(OpenRequest {
                path: path.to_string_lossy().into_owned(),
                line,
                col,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_and_column_suffixes() {
        let cwd = std::env::temp_dir();
        let args: Vec<String> = ["daf", "-nosession", "nofile.rs:12:4", "other.txt:7"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let reqs = parse(&args, &cwd);
        assert_eq!(reqs.len(), 2);
        assert!(reqs[0].path.ends_with("nofile.rs"));
        assert_eq!((reqs[0].line, reqs[0].col), (Some(12), Some(4)));
        assert!(reqs[1].path.ends_with("other.txt"));
        assert_eq!((reqs[1].line, reqs[1].col), (Some(7), None));
    }
}
