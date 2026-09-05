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

## Native approval bridge

`@jhckevin/dsh-auto-review-bridge-host` and
`@jhckevin/dsh-auto-review-bridge-linux-x64-gnu`, version `0.1.0-rc.2`, are
separate Apache-2.0 artifacts, not MIT assets relicensed by this notice. The
main package has an exact host dependency. Source-checkout CI resolves the
verified archives through the lockfile; installation requires a separately
protected matching native runtime. Package-specific source, license,
provenance and version-matched development execution receipts must accompany distribution.
This is bounded protocol validation, not complete Codex Guardian execution.
There is no claim of public npm publication, and no silent legacy fallback.

## Codex Desktop Auto Review shield-terminal glyph

The shield-terminal SVG paths currently used by the Auto Review tool-call badge
and settings navigation were extracted from the locally installed OpenAI Codex
Desktop application at the user's explicit request. They are not independently
created artwork. This source attribution does not establish copyright ownership,
copyright eligibility, public-domain status, or a redistribution license.

On 2026-09-03 the maintainer reported that the glyph is widely used and believed
it to be free of copyright, and requested that its source be acknowledged. No
specific license text or public-domain declaration supporting that assessment
was supplied in this review. We record it as a maintainer-reported assessment,
not as a verified legal conclusion or a permission grant from the source owner.

The project's MIT License does not purport to license this glyph. Rewriting SVG
paths to reproduce the same appearance would not, by itself, verify the rights
status. This notice is attribution, not proof of permission. No OpenAI endorsement
is implied; any applicable third-party rights and terms are reserved.

中文说明：当前图标参考并提取自 Codex Desktop，非本项目独立原创；用于自动
审查命令标识和设置选项卡。维护者表示经调查认为该图标不受版权保护，但本次
未提供可核验的许可或公共领域声明。因此这里只标明来源，不宣称“已确认无版权”，
也不将图标纳入项目自有代码的 MIT 授权范围。此说明本身不构成再分发许可。

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

## DeepSeek Harness host patches

Files under `patches/` modify the MIT-licensed DeepSeek Harness and preserve
the upstream project license in `licenses/DSH-LICENSE`. The rc.2 hot-install
series starts at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` and ends at
`b9d1317287dd122188210cf7775017462f45cd86`. These are downstream changes, not
upstream endorsement or a claim that unmodified DSH already has these seams.
# DSH UI owner bundles

The two version-pinned files under `ui/rc2/` contain modified DeepSeek Harness
UI code from commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
Copyright (c) 2026 DeepSeek. MIT license: [licenses/DSH-UI-MIT.txt](licenses/DSH-UI-MIT.txt).
The modifications add the tool badge and settings icon extension slots;
source diffs are included under `patches/`. Original and replacement hashes
are recorded in `ui/manifest.json`. These are not official DeepSeek builds.
