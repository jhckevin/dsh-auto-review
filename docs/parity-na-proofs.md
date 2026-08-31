# Codex upstream inventory N/A proofs

## codex-tui-na

Target product is the DeepSeek Harness WebUI extension on Linux x86_64. Codex TUI rendering, Ratatui widgets, terminal snapshots, keyboard shortcuts, and TUI-only state containers cannot be ported as executable source into that target. Their observable approval lifecycle semantics remain assigned to the `app-server-ui-tui` module and must be covered by WebUI tests before that module can become complete. This proof excludes only the TUI implementation technology, not behavior.

## bazel-build-na

Target package is built and distributed through the DeepSeek Harness pnpm extension system. Codex Bazel `BUILD.bazel` metadata is not executable in that build graph. All Rust/Markdown implementation and policy assets referenced by Bazel remain independently inventoried and assigned. This proof excludes only Bazel metadata, not source, assets, tests, packaging checks, or license obligations.
