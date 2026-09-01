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

## Approval protocol oracle

`scripts/generate-codex-approval-protocol-oracle.sh` creates a clean detached
worktree at the same full commit and applies
`codex-approval-protocol-oracle.patch`. The injected Rust tests call the real
core protocol, app-server v2 protocol, PermissionRequest parser/fold, and
codex-core ApprovalStore/reviewer-route implementations. Each source input is
locked by its Git blob ID; output is written to scratch files and only replaces
the four checked-in JSON fixtures after every Rust test succeeds.

The PermissionRequest and ApprovalStore fixtures are dependency truth for the
next runtime stage. Their presence does not claim that the hook/store lifecycle
is integrated in ISSUE-022B1.
