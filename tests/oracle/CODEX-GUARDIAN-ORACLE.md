# Codex Guardian 真值 oracle

`codex-core-guardian-oracle.patch` 只会应用到由脚本创建的、固定提交
`9f97cb79eb15b38d24c552c56fe24e211ff9cf3a` 的临时 Git worktree。
它把一个 `#[cfg(test)]` 子模块注入 `codex-core::guardian`，因此测试直接调用上游私有：

- 七种真实 `ApprovalAction` 的 `into_guardian_request`
- `ApprovalAction::permission_request_payload`
- `ApprovalAction::cache_keys`
- `command_canonicalization::canonicalize_command_for_approval`
- `GuardianApprovalRequest`
- `guardian_approval_request_to_json`
- `guardian_assessment_action`
- `guardian_reviewed_action`
- `format_guardian_action_pretty`
- 上游 `PermissionProfile` 的 `Serialize`
- `AdditionalPermissionProfile` 的 legacy/canonical 反序列化后再序列化
- `PathUri` 的 Eq/Hash、cache-key serde、原始 POSIX bytes 恢复与 Guardian cwd seam

它不是重新声明 DTO，也不会修改提供的 Codex checkout。脚本先锁定提交及所有参与
conversion、Guardian serde、权限、路径与 shell 解析的上游 Git blob，再建立临时 worktree、注入、运行
`cargo test -p codex-core --lib`、产出 golden，最后移除临时 worktree。

远程验证命令：

```sh
CODEX_ORACLE_ROOT=/srv/pi-lab-dev/tmp/codex-9f97cb79 \
CARGO_BIN=/srv/pi-lab-dev/tmp/rustup/toolchains/1.96.0-x86_64-unknown-linux-gnu/bin/cargo \
CARGO_HOME=/srv/pi-lab-dev/tmp/cargo \
RUSTUP_HOME=/srv/pi-lab-dev/tmp/rustup \
RUSTUP_TOOLCHAIN=1.96.0-x86_64-unknown-linux-gnu \
CARGO_TARGET_DIR=/srv/pi-lab-dev/tmp/codex-oracle-target \
scripts/generate-codex-guardian-oracle.sh
```

固定 golden 应包含 14 个 Guardian fixture（七种真实 `ApprovalAction` 的
minimal/options）、两个严格转换错误边界和五个 `PermissionProfile` fixture。
每个 Guardian fixture 同时保存真实 conversion 产生的 Guardian JSON、permission request
payload、cache keys、assessment、reviewed analytics 与 pretty/truncation 输出。两个错误边界
覆盖 foreign remote cwd 与 ApplyPatch 工作区外文件，确保 oracle 也验证拒绝路径。

此外还包括六个 `AdditionalPermissionProfile` fixture，覆盖 legacy 空数组正规化、
legacy path、canonical-to-legacy collapse、deny/glob/missing/depth、unknown/project_roots、
Windows raw path，以及一个非 UTF-8 permission path 的真实序列化错误。PathUri 真值覆盖
Windows decoded-byte ASCII case folding、encoded separator、cache key 原 URI、普通与 opaque
POSIX bytes 恢复，以及 WriteStdin/Network Guardian cwd 的 lossy seam。

## 已验证门禁

固定提交上的真实生成已通过：`1 passed; 0 failed; 2381 filtered out`，golden 为
39,258 bytes，SHA-256 为
`2ceec505266cd6571f7e6e6ae153c0f2b7bbe8f1914a4ed82f3bdecbfc34fb21`。
生成结束后 scratch、owner lock 与 Git worktree registration 均不存在。

同一 golden 还包含 54 个既有 shell corpus 与 4 个 wrapper 边界。所有 canonical
输出均由上游 `canonicalize_command_for_approval` 在 `codex-core` 内实际执行，而不是由
测试仓库中的复制版 shell detector 推算。

`test-codex-guardian-oracle-wrapper.sh` 是不触发 Rust 编译的 wrapper 故障门禁：它验证
已有 scratch/lock 时第二实例退出 `1` 且不夺取 owner；再以发送 `TERM` 的 fake cargo
验证生成器退出 `143`，同时清理 scratch、lock 与 worktree registration。
