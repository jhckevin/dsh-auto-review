#!/bin/sh
set -eu

root=${CODEX_ORACLE_ROOT:?set CODEX_ORACLE_ROOT to an exact Codex checkout}
expected=9f97cb79eb15b38d24c552c56fe24e211ff9cf3a
actual=$(git -C "$root" rev-parse HEAD)
if [ "$actual" != "$expected" ]; then
  echo "expected Codex $expected, found $actual" >&2
  exit 1
fi
test "$(git -C "$root" hash-object codex-rs/shell-command/src/bash.rs)" = ddd5807bfce5d1a54796e7a557b77d589be14d35
test "$(git -C "$root" hash-object codex-rs/shell-command/src/shell_detect.rs)" = c74532cee33e4945bc63880a9dadb96a78399e5f
test "$(git -C "$root" hash-object codex-rs/utils/path-uri/src/lib.rs)" = 3eb754bf6e28b52f57bfd4a39a260e0e426d0971

work=${TMPDIR:-/tmp}/dsh-codex-oracle-022a
cargo_bin=${CARGO_BIN:-cargo}
if ! command -v "$cargo_bin" >/dev/null 2>&1; then
  echo "cargo executable not found: $cargo_bin (set CARGO_BIN explicitly)" >&2
  exit 127
fi
mkdir -p "$work/src"
cp tests/oracle/main.rs "$work/src/main.rs"
cp "$root/codex-rs/shell-command/src/bash.rs" "$work/src/bash.rs"
cp "$root/codex-rs/shell-command/src/shell_detect.rs" "$work/src/shell_detect.rs"
cat > "$work/Cargo.toml" <<EOF
[package]
name = "dsh-codex-oracle-022a"
version = "0.0.0"
edition = "2024"

[workspace]

[dependencies]
codex-utils-path-uri = { path = "$root/codex-rs/utils/path-uri" }
libc = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
shlex = "1.3.0"
tree-sitter = "0.25.10"
tree-sitter-bash = "0.25"
which = "=6.0.3"
EOF
cp "$root/codex-rs/Cargo.lock" "$work/Cargo.lock"
output="$work/codex-9f97cb79.json.tmp"
"$cargo_bin" run --quiet --manifest-path "$work/Cargo.toml" > "$output"
test -s "$output"
mv "$output" tests/oracle/codex-9f97cb79.json
