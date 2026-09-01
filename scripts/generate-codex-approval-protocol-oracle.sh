#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
source_root=${CODEX_ORACLE_ROOT:?set CODEX_ORACLE_ROOT}
expected=9f97cb79eb15b38d24c552c56fe24e211ff9cf3a
cargo_bin=${CARGO_BIN:?set CARGO_BIN}
rustc_bin=${RUSTC_BIN:?set RUSTC_BIN}
cargo_home=${CARGO_HOME:?set CARGO_HOME}
rustup_home=${RUSTUP_HOME:?set RUSTUP_HOME}
target_dir=${CARGO_TARGET_DIR:?set CARGO_TARGET_DIR}
scratch=${CODEX_APPROVAL_ORACLE_SCRATCH:-$target_dir-worktree}
core_output=${CODEX_APPROVAL_PROTOCOL_ORACLE_OUTPUT:-$repo/tests/oracle/codex-approval-protocol-9f97cb79.json}
v2_output=${CODEX_APPROVAL_PROTOCOL_V2_ORACLE_OUTPUT:-$repo/tests/oracle/codex-approval-protocol-v2-9f97cb79.json}
permission_output=${CODEX_PERMISSION_REQUEST_ORACLE_OUTPUT:-$repo/tests/oracle/codex-permission-request-9f97cb79.json}
store_output=${CODEX_APPROVAL_STORE_ORACLE_OUTPUT:-$repo/tests/oracle/codex-approval-store-9f97cb79.json}
test -x "$cargo_bin" && test -x "$rustc_bin"
test "$(git -C "$source_root" cat-file -t "$expected")" = commit
check_blob() {
  test "$(git -C "$source_root" rev-parse "$expected:$1")" = "$2" || {
    echo "oracle input blob mismatch: $1" >&2
    exit 1
  }
}
check_blob codex-rs/protocol/src/config_types.rs b5ac448ebca7f0ad7933b1361a9a6e2c1632a300
check_blob codex-rs/protocol/src/protocol.rs 3a8c087efa15e7c2357e99a555368a683a945eb5
check_blob codex-rs/protocol/src/approvals.rs c051430ec4a3fde5ca30b4832bf720995a9c5467
check_blob codex-rs/protocol/src/parse_command.rs 77926f11b66fc9ac3eb4f0766dffd834f010ed6e
check_blob codex-rs/app-server-protocol/src/protocol/v2/shared.rs b5a68a073a2ac78e3078570ea8067fd9261cbd1e
check_blob codex-rs/app-server-protocol/src/protocol/v2/item.rs 67b8c41d5b30eb412e8120a2a8c603e54a49c906
check_blob codex-rs/hooks/src/events/permission_request.rs 58da6c8e4d11082ff5ba402c2f2f705b75a9ed09
check_blob codex-rs/hooks/src/engine/output_parser.rs aaefa46dc10217a5e9259b9f8ff010bfee0f7c36
check_blob codex-rs/core/src/tools/sandboxing.rs 615b91741386577d6a71754675f20478ba98d56e
check_blob codex-rs/core/src/tools/sandboxing_tests.rs 0a9e1fe114d483cfb839be42d0d1226649d1a401
check_blob codex-rs/core/src/guardian/review.rs 2882cb799f372669e656a7a3de784ed540c6b570
test ! -e "$scratch" || { echo "oracle scratch exists: $scratch" >&2; exit 1; }
lock=$scratch.lock
mkdir "$lock"
printf '%s\n' "$$" >"$lock/owner.pid"
mkdir "$scratch"
checkout=$scratch/codex
tmp_core=$scratch/core.json
tmp_v2=$scratch/v2.json
tmp_permission=$scratch/permission.json
tmp_store=$scratch/store.json
cleanup() {
  rc=$?
  trap - EXIT HUP INT TERM
  git -C "$source_root" worktree remove --force "$checkout" >/dev/null 2>&1 || true
  rm -f "$tmp_core" "$tmp_v2" "$tmp_permission" "$tmp_store" "$lock/owner.pid"
  rmdir "$scratch" "$lock" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT HUP INT TERM
git -C "$source_root" worktree add --detach "$checkout" "$expected" >/dev/null
git -C "$checkout" apply --check "$repo/tests/oracle/codex-approval-protocol-oracle.patch"
git -C "$checkout" apply "$repo/tests/oracle/codex-approval-protocol-oracle.patch"
common_env="CARGO_HOME=$cargo_home RUSTUP_HOME=$rustup_home RUSTUP_TOOLCHAIN=1.96.0-x86_64-unknown-linux-gnu CARGO_TARGET_DIR=$target_dir RUSTC=$rustc_bin OPENSSL_LIB_DIR=${OPENSSL_LIB_DIR:-/usr/lib/x86_64-linux-gnu} OPENSSL_INCLUDE_DIR=${OPENSSL_INCLUDE_DIR:-/usr/include}"
(
  cd "$checkout/codex-rs"
  env $common_env CODEX_APPROVAL_PROTOCOL_ORACLE_OUTPUT="$tmp_core" "$cargo_bin" test --locked -p codex-protocol --test approval_protocol_oracle export_approval_protocol_oracle -- --exact --nocapture
  env $common_env CODEX_APPROVAL_PROTOCOL_V2_ORACLE_OUTPUT="$tmp_v2" "$cargo_bin" test --locked -p codex-app-server-protocol --test approval_protocol_v2_oracle export_approval_protocol_v2_oracle -- --exact --nocapture
  env $common_env CODEX_PERMISSION_REQUEST_ORACLE_OUTPUT="$tmp_permission" "$cargo_bin" test --locked -p codex-hooks --lib events::permission_request::tests::export_permission_request_protocol_oracle -- --exact --nocapture
  env $common_env CODEX_APPROVAL_STORE_ORACLE_OUTPUT="$tmp_store" "$cargo_bin" test --locked -p codex-core --lib tools::sandboxing::tests::export_approval_store_and_route_oracle -- --exact --nocapture
)
test -s "$tmp_core" && test -s "$tmp_v2" && test -s "$tmp_permission" && test -s "$tmp_store"
mv "$tmp_core" "$core_output"
mv "$tmp_v2" "$v2_output"
mv "$tmp_permission" "$permission_output"
mv "$tmp_store" "$store_output"
sha256sum "$core_output" "$v2_output" "$permission_output" "$store_output"
