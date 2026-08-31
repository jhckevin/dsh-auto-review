#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
source_root=${CODEX_ORACLE_ROOT:?set CODEX_ORACLE_ROOT to a Codex checkout containing the fixed commit}
expected=9f97cb79eb15b38d24c552c56fe24e211ff9cf3a
output=${CODEX_GUARDIAN_ORACLE_OUTPUT:-$repo/tests/oracle/codex-guardian-9f97cb79.json}
cargo_bin=${CARGO_BIN:-cargo}
cargo_home=${CARGO_HOME:?set CARGO_HOME}
rustup_home=${RUSTUP_HOME:?set RUSTUP_HOME}
toolchain=${RUSTUP_TOOLCHAIN:-1.96.0-x86_64-unknown-linux-gnu}
target_dir=${CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/dsh-codex-guardian-oracle-target}

test "$(git -C "$source_root" cat-file -t "$expected")" = commit
check_blob() {
  path=$1
  expected_blob=$2
  actual_blob=$(git -C "$source_root" rev-parse "$expected:$path")
  if test "$actual_blob" != "$expected_blob"; then
    echo "oracle input blob mismatch: $path ($actual_blob != $expected_blob)" >&2
    exit 1
  fi
}
check_blob codex-rs/core/src/guardian/mod.rs 2e8b136f5d221042426dc004d3541a0ddb710158
check_blob codex-rs/core/src/guardian/approval_request.rs 786c3eedf0b40cf2a5ef1f0682b0bad0a7125792
check_blob codex-rs/core/src/tools/approvals.rs 5da0a46c74a9482f74158e7101ce7fc25403a2f5
check_blob codex-rs/core/src/tools/hook_names.rs 92ebe8aa56de1ad7fe62be417666eb169c2c3b24
check_blob codex-rs/core/src/tools/sandboxing.rs 615b91741386577d6a71754675f20478ba98d56e
check_blob codex-rs/core/src/command_canonicalization.rs b88a79375d825b3438f5bcefa0f1db89b1f2e885
check_blob codex-rs/protocol/src/models.rs 9005f811a0ca2ecd0746cd882140208bcb0de43d
check_blob codex-rs/protocol/src/permissions.rs 4f6303a7096a97a87048a50a5d5d7bb0975126bb
check_blob codex-rs/protocol/src/request_permissions.rs f9ade7d149edd38460107d97c874878348e52061
check_blob codex-rs/utils/path-uri/src/lib.rs 3eb754bf6e28b52f57bfd4a39a260e0e426d0971
check_blob codex-rs/shell-command/src/bash.rs ddd5807bfce5d1a54796e7a557b77d589be14d35
check_blob codex-rs/shell-command/src/powershell.rs 0b668eb4943ea3110a5c269a4e7fcea7cd0cb82c
check_blob codex-rs/shell-command/src/lib.rs 898965e93729618d49d59861b1f0ad62a72fbf59
check_blob codex-rs/analytics/src/events.rs dcfed40304833781ea0b2db0424108a02b76263f
command -v "$cargo_bin" >/dev/null 2>&1

scratch=${CODEX_ORACLE_SCRATCH:-$target_dir-worktree}
checkout=$scratch/codex
tmp_output=$scratch/oracle.json
lock_dir=$scratch.lock
owner_file=$lock_dir/owner.pid
if test -e "$scratch"; then
  echo "oracle scratch already exists (another run or stale state): $scratch" >&2
  exit 1
fi
if ! mkdir "$lock_dir"; then
  echo "oracle lock already exists (active run or stale state): $lock_dir" >&2
  exit 1
fi
printf '%s\n' "$$" > "$owner_file"
if ! mkdir "$scratch"; then
  rm -f "$owner_file"
  rmdir "$lock_dir"
  echo "failed to create oracle scratch: $scratch" >&2
  exit 1
fi
cleanup() {
  original_rc=$?
  cleanup_rc=0
  trap - EXIT HUP INT TERM
  if git -C "$source_root" worktree list --porcelain |
    grep -Fqx "worktree $checkout"; then
    git -C "$source_root" worktree remove --force "$checkout" >/dev/null 2>&1 || cleanup_rc=1
  elif test -e "$checkout"; then
    echo "unregistered oracle checkout retained: $checkout" >&2
    cleanup_rc=1
  fi
  rm -f "$tmp_output" || cleanup_rc=1
  if test -d "$scratch" && ! rmdir "$scratch"; then
    echo "oracle scratch retained because it is not empty: $scratch" >&2
    cleanup_rc=1
  fi
  rm -f "$owner_file" || cleanup_rc=1
  if test -d "$lock_dir" && ! rmdir "$lock_dir"; then
    echo "oracle lock retained because it is not empty: $lock_dir" >&2
    cleanup_rc=1
  fi
  if test "$original_rc" -ne 0; then
    exit "$original_rc"
  fi
  exit "$cleanup_rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

git -C "$source_root" worktree add --detach "$checkout" "$expected" >/dev/null
git -C "$checkout" apply --check "$repo/tests/oracle/codex-core-guardian-oracle.patch"
git -C "$checkout" apply "$repo/tests/oracle/codex-core-guardian-oracle.patch"

(
  cd "$checkout/codex-rs"
  env \
    CARGO_HOME="$cargo_home" \
    RUSTUP_HOME="$rustup_home" \
    RUSTUP_TOOLCHAIN="$toolchain" \
    CARGO_TARGET_DIR="$target_dir" \
    CODEX_ORACLE_OUTPUT="$tmp_output" \
    OPENSSL_LIB_DIR="${OPENSSL_LIB_DIR:-/usr/lib/x86_64-linux-gnu}" \
    OPENSSL_INCLUDE_DIR="${OPENSSL_INCLUDE_DIR:-/usr/include}" \
    "$cargo_bin" test --locked -p codex-core --lib \
      guardian::oracle_export::export_issue_022a_oracle -- --exact --nocapture
)
test -s "$tmp_output"
mkdir -p "$(dirname "$output")"
mv "$tmp_output" "$output"
sha256sum "$output"
