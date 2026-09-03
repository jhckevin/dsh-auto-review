# ISSUE-032 / GitHub #6: alpha5 native lifecycle compatibility

Candidate 0.5.7-alpha.2; exact DSH 0.1.2-alpha.5. This is a separate historical compatibility branch, not a retag of an old release. All direct and locked DSH packages remain on this one version.

Ported the current per-provider NativeApprovalScope, synchronous abort on disposal, generation-isolated breaker state, no late approval, preserved settings on same-default reload and the public-named bridge host/platform 0.1.0-rc.1. Default codex-native remains enabled; no legacy fallback or protected-path bypass was added. The bridge tgz bytes and SHA512 match the rc2 candidate. This is the limited Core serde bridge, not a complete Guardian execution implementation.

Full source/test type checking is enabled. Linux Node24 build and tests: 199 passed; 3 optional upstream UI tests skipped. Policy provenance and packed offline import passed. The old rc6 fixtures needed real missing envelope fields, discriminant guards and async tool signature corrections; assertions were not weakened. No model API was called. Fresh dependencies consumed under 230MB per channel, no Rust build.

Run `node scripts/check-compat-channel.mjs alpha5` after `npm ci --ignore-scripts --registry=https://registry.npmmirror.com`. `--matrix` prints all three exact channel/version rows. The report separates source gates from NOT_EXERCISED cold install, protected native execution and browser hot installation. Logs retain skipped tests. Set DSH_COMPAT_REPORT_DIR to choose an evidence directory.

The rc2 discovery and additive-client graph patches both FAILED git apply --cached --check against this channel's exact original DSH HEAD, including source conflicts. They are not shipped or advertised as compatible here. Alpha keeps its prior owner UI slot patches; rc6 has no new owner patch. No new cold/host/browser installation was performed for this candidate; prior rc2 browser success cannot be transferred to it. Native protected runtime setup still requires the same root-owned canonical deployment and independent non-root execution verification. Public cold installation, patch migration, real-model behavior and production security remain separate gates.

Do not use old README version paragraphs as current release certification: this document is the authoritative delta for this compatibility candidate. No npm or GitHub publication is performed by these changes.
