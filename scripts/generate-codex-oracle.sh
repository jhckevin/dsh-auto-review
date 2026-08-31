#!/bin/sh
set -eu

root=${CODEX_ORACLE_ROOT:?set CODEX_ORACLE_ROOT to an exact Codex checkout}
expected=9f97cb79eb
actual=$(git -C "$root" rev-parse --short=10 HEAD)
if [ "$actual" != "$expected" ]; then
  echo "expected Codex $expected, found $actual" >&2
  exit 1
fi
test "$(git -C "$root" hash-object codex-rs/shell-command/src/bash.rs)" = ddd5807bfce5d1a54796e7a557b77d589be14d35
test "$(git -C "$root" hash-object codex-rs/utils/path-uri/src/lib.rs)" = 3eb754bf6e28b52f57bfd4a39a260e0e426d0971
test "$(git -C "$root" hash-object codex-rs/core/src/guardian/approval_request.rs)" = 786c3eedf0b40cf2a5ef1f0682b0bad0a7125792
test "$(git -C "$root" hash-object codex-rs/core/src/tools/approvals.rs)" = 5da0a46c74a9482f74158e7101ce7fc25403a2f5

work=${TMPDIR:-/tmp}/dsh-codex-oracle-022a
cargo_bin=${CARGO_BIN:-cargo}
if ! command -v "$cargo_bin" >/dev/null 2>&1; then
  echo "cargo executable not found: $cargo_bin (set CARGO_BIN explicitly)" >&2
  exit 127
fi
mkdir -p "$work/src"
cp tests/oracle/main.rs "$work/src/main.rs"
cp "$root/codex-rs/shell-command/src/bash.rs" "$work/src/bash.rs"
cp tests/oracle/powershell.rs "$work/src/powershell.rs"
cp tests/oracle/shell_detect.rs "$work/src/shell_detect.rs"
cat > "$work/Cargo.toml" <<EOF
[package]
name = "dsh-codex-oracle-022a"
version = "0.0.0"
edition = "2024"

[workspace]

[dependencies]
codex-utils-path-uri = { path = "$root/codex-rs/utils/path-uri" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
shlex = "1.3.0"
tree-sitter = "0.25.10"
tree-sitter-bash = "0.25"
EOF
cp "$root/codex-rs/Cargo.lock" "$work/Cargo.lock"
output="$work/codex-9f97cb79.json.tmp"
"$cargo_bin" run --quiet --manifest-path "$work/Cargo.toml" > "$output"
test -s "$output"
mv "$output" tests/oracle/codex-9f97cb79.json
