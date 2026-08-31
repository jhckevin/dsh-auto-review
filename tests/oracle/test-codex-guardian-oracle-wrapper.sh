#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
source_root=${CODEX_ORACLE_ROOT:?set CODEX_ORACLE_ROOT}
cargo_home=${CARGO_HOME:?set CARGO_HOME}
rustup_home=${RUSTUP_HOME:?set RUSTUP_HOME}
target_dir=${CARGO_TARGET_DIR:?set CARGO_TARGET_DIR}
base=${TMPDIR:-/tmp}/dsh-guardian-oracle-wrapper-test.$$
lock_scratch=$base.lock-case
signal_scratch=$base.signal-case
fake_cargo=$base.fake-cargo

cleanup() {
  rm -f "$fake_cargo" "$lock_scratch.lock/owner.pid"
  rmdir "$lock_scratch.lock" "$lock_scratch" >/dev/null 2>&1 || true
  if git -C "$source_root" worktree list --porcelain |
    grep -Fqx "worktree $signal_scratch/codex"; then
    git -C "$source_root" worktree remove --force "$signal_scratch/codex" >/dev/null 2>&1 || true
  fi
  rm -f "$signal_scratch/oracle.json" "$signal_scratch.lock/owner.pid"
  rmdir "$signal_scratch" "$signal_scratch.lock" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sh -n "$repo/scripts/generate-codex-guardian-oracle.sh"

mkdir "$lock_scratch" "$lock_scratch.lock"
printf '%s\n' preexisting-owner > "$lock_scratch.lock/owner.pid"
set +e
CODEX_ORACLE_ROOT="$source_root" CARGO_BIN=/bin/false \
  CARGO_HOME="$cargo_home" RUSTUP_HOME="$rustup_home" \
  CARGO_TARGET_DIR="$target_dir" CODEX_ORACLE_SCRATCH="$lock_scratch" \
  "$repo/scripts/generate-codex-guardian-oracle.sh" >/dev/null 2>&1
lock_rc=$?
set -e
test "$lock_rc" -eq 1
test "$(cat "$lock_scratch.lock/owner.pid")" = preexisting-owner

printf '%s\n' '#!/bin/sh' 'kill -TERM "$PPID"' 'sleep 1' 'exit 0' > "$fake_cargo"
chmod 755 "$fake_cargo"
set +e
CODEX_ORACLE_ROOT="$source_root" CARGO_BIN="$fake_cargo" \
  CARGO_HOME="$cargo_home" RUSTUP_HOME="$rustup_home" \
  CARGO_TARGET_DIR="$target_dir" CODEX_ORACLE_SCRATCH="$signal_scratch" \
  "$repo/scripts/generate-codex-guardian-oracle.sh" >/dev/null 2>&1
signal_rc=$?
set -e
test "$signal_rc" -eq 143
test ! -e "$signal_scratch"
test ! -e "$signal_scratch.lock"
! git -C "$source_root" worktree list --porcelain |
  grep -Fq "$signal_scratch/codex"

printf 'lock_rc=%s signal_rc=%s cleanup=absent\n' "$lock_rc" "$signal_rc"
