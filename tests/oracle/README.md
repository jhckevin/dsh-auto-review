# Codex 9f97cb79 oracle

`main.rs` is compiled against an exact checkout of OpenAI Codex commit
`9f97cb79eb`. It compiles the upstream `bash.rs` parser verbatim and calls the
upstream `codex-utils-path-uri` crate directly, then emits the checked-in
`codex-9f97cb79.json` fixture. `scripts/generate-codex-oracle.sh` refuses any
other commit before building, so the golden cannot silently drift.

The shell list is the complete script corpus in the `bash.rs` test module at
that commit, plus the four `command_canonicalization_tests.rs` commands. The
Guardian records are source-derived serialization fixtures, not calls into
Codex's private `into_guardian_request` conversion. The generator verifies the
Git blobs of `tools/approvals.rs` (conversion mapping) and
`guardian/approval_request.rs` (private Serialize DTOs); the Rust structs in
`main.rs` mirror those DTOs. The 13 records cover all seven variants and the
absent/present optional-field combinations, while remaining source-derived.
