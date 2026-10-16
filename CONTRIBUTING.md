# Contributing to Daf

Thanks for helping. Bug reports are as valuable as code, especially for encodings and right-to-left text.

## Reporting a bug

[Open an issue](https://github.com/Felixumansky/daf-editor/issues/new/choose) and include:

- the Daf version (*Help → About Daf*) and your Windows version,
- what you did, what you expected, and what happened,
- for encoding or right-to-left problems, a small sample file if you can share one.

## Building

You need Rust 1.99 (pinned in `rust-toolchain.toml`), Node.js 24, and on Windows the MSVC build tools and the Windows 11 SDK.

```sh
npm install
npm run tauri dev
```

## Before you open a pull request

CI runs these, so run them locally first:

```sh
npm run check
npm test
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Keep pull requests focused on one change. For a larger feature, open an issue first so we can agree on the approach.

New user-facing text goes in both `src/lib/i18n/en.ts` and `src/lib/i18n/he.ts`.

## License

By contributing, you agree that your contribution is licensed under the [Mozilla Public License 2.0](LICENSE).
