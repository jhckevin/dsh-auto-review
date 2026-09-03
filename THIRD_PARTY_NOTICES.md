# Third-Party Notices

The root `LICENSE` applies to this project's independently authored code. It
does not replace the licenses of third-party material or grant rights to the
Codex Desktop glyph described below. Preserve this file, `NOTICE`, and the
applicable files under `licenses/` when redistributing the corresponding code,
assets, or compiled output.

## OpenAI Codex Guardian policy corpus

`policies/codex/guardian-policy-template.md` and
`policies/codex/guardian-policy.md` are verbatim snapshots from the OpenAI
Codex repository, commit `04caa22c8220c24b1428dbeaebcb744bf3875771`, paths
`codex-rs/core/src/guardian/policy_template.md` and
`codex-rs/core/src/guardian/policy.md`. They remain subject to the upstream
Apache License 2.0 and are not relicensed by this package's MIT License.

Upstream source: https://github.com/openai/codex

The complete upstream Apache-2.0 license is reproduced without changes in
`licenses/CODEX-LICENSE`; the upstream NOTICE is reproduced without changes in
`licenses/CODEX-NOTICE`. Both files are identical at the policy snapshot commit
above and at the port baseline `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`.

## OpenAI Codex-derived TypeScript ports

The Codex-derived portions of `src/codex-parity/` retain the upstream
Apache-2.0 terms. Their inclusion in an MIT project is not a relicensing of the
upstream work. Copyright 2025 OpenAI; see `licenses/CODEX-NOTICE` for the full
upstream notice. These are modified TypeScript adaptations of Rust sources,
not verbatim copies and not a claim of complete Guardian implementation.

Port baseline: https://github.com/openai/codex/tree/9f97cb79eb15b38d24c552c56fe24e211ff9cf3a

The checked-in `docs/parity-manifest.json` supplies the symbol-level mapping:

- `approval-action.ts`, `command-canonicalization.ts`, `types.ts`, `path.ts`,
  `permission-profile.ts`, and `validation.ts`: approval-action/cache-key and
  command-canonicalization adaptations from `core/src/tools/approvals.rs` and
  `core/src/command_canonicalization.rs`, with supporting path/permission types.
- `approval-protocol.ts` and its `index.ts` exports: mappings from
  `protocol/src/{approvals,config_types,protocol}.rs`, app-server v2 protocol,
  hooks permission/output parsing, and sandbox/Guardian decision types.
- `guardian-request.ts` and shared types/path/permission helpers: adaptations
  from `core/src/guardian/approval_request.rs`.

All upstream paths above are under `codex-rs/`. This notice covers the related
compiled `lib/codex-parity/` output and does not change the recorded validation
status of any module.

## Optional native approval bridge

`@dsh/codex-approval-bridge-host` and its Linux platform package are separate
Apache-2.0 prototype artifacts, not MIT assets included by this notice. The
main package declares an optional peer, but its default `codex-native` profile
still requires a separately installed, trusted matching artifact. See
`docs/ISSUE-026-OPEN-SOURCE.md` for the publication blockers. There is no claim
that the default profile works from public npm alone, and no silent legacy
fallback is authorized by this documentation.

## Codex Desktop Auto Review shield-terminal glyph

The shield-terminal SVG path used by the Auto Review Tool-call badge was
extracted from the locally installed OpenAI Codex Desktop application at the
user's explicit request. Copyright and all other rights in that glyph remain
with OpenAI and its licensors. The glyph is not licensed under this repository's
MIT License. Redistributors are responsible for obtaining any permission their
use requires.

Source application observed during implementation:
`OpenAI.Codex_26.810.7004.0_x64`, resources
`auto-review-approval-nudge-DdaabOhz.js` and
`app-initial-TxV8Ik1J.js`.

## Lucide shield-off slash geometry

The denied-state slash geometry (`m2 2 20 20`) follows the Lucide shield-off
icon bundled by Codex Desktop. Lucide is available under the ISC License:
https://lucide.dev/license

## Tree-sitter runtime and Bash grammar

The Codex approval-cache canonicalizer uses `tree-sitter` and
`tree-sitter-bash` 0.25.1 to preserve the upstream AST acceptance boundary.
Both packages, together with their `node-addon-api` and `node-gyp-build`
runtime dependencies, are distributed under their respective MIT licenses.

Sources: https://github.com/tree-sitter/node-tree-sitter and
https://github.com/tree-sitter/tree-sitter-bash
