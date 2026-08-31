# Codex 9f97cb79eb15b38d24c552c56fe24e211ff9cf3a parsing oracle

`main.rs` is compiled against an exact checkout of OpenAI Codex commit
`9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`. It compiles the upstream `bash.rs` parser verbatim and calls the
upstream `codex-utils-path-uri` crate directly, then emits the checked-in
`codex-9f97cb79.json` fixture. `scripts/generate-codex-oracle.sh` refuses any
other commit before building, so the golden cannot silently drift.

The shell list is the complete 54-script corpus in the `bash.rs` test module at
that commit. This legacy oracle is limited to Bash parsing, PathUri conversion,
and shlex joining. It is not a Guardian, ApprovalAction, or command
canonicalization oracle. Guardian conversion, payload, cache-key, serde,
assessment, reviewed-action, formatting, and command canonicalization truth
comes exclusively from the real codex-core oracle documented in
`CODEX-GUARDIAN-ORACLE.md`.
