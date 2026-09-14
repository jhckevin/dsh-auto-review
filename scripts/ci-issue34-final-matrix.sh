#!/bin/sh
set -eu
lab=/srv/pi-lab-dev/ci-issue34-20260914
src=/srv/pi-lab-dev/worktrees/dsh-auto-review-issue34
docker_ci() { docker -H unix://$lab/docker.sock "$@"; }
for cohort in rc6 rc2 alpha5; do
  case "$cohort" in rc6) folder=rc6-exact2; base=ar34/final13-rc6:ready;; rc2) folder=rc2; base=ar34/final11-rc2:ready;; alpha5) folder=alpha5-exact2; base=ar34/final13-alpha5:ready;; esac
  out=$lab/$folder/final15-results
  mkdir -p "$out"
  chown 1000:1000 "$out"
  docker_ci run --name ar34-matrix15-$cohort --label acceptance=issue34-20260914 --network host --memory 4g --memory-swap 4g --cpus 2 --pids-limit 256 -e ARTIFACT=/artifacts/candidate15.tgz -v "$lab/$folder/work:/work" -v "$src/scripts:/ci:ro" -v "$lab/packages:/artifacts:ro" "$base" sh /ci/ci-issue34-upgrade.sh > "$out/install.log" 2>&1
  test "$(docker_ci inspect ar34-matrix15-$cohort --format '{{.State.Status}}:{{.State.ExitCode}}')" = exited:0
  docker_ci commit ar34-matrix15-$cohort ar34/final15-$cohort:ready > "$out/image-id"
  docker_ci run --name ar34-gate15-$cohort --label acceptance=issue34-20260914 --network none --memory 2g --memory-swap 2g --cpus 2 --pids-limit 256 --user 1000:1000 -e HOME=/work/user -e DSH_HOME=/work/user/.dsh -e PREFLIGHT_ONLY=1 -e EXPECT_UI=1 -e DSH_AUTO_REVIEW_NATIVE_RUNTIME=/opt/dsh-auto-review-native/0.1.0-rc.2/node_modules/@jhckevin/dsh-auto-review-bridge-linux-x64-gnu -v "$lab/$folder/work/user:/work/user" -v "$src/scripts:/ci:ro" -v "$out:/results" ar34/final15-$cohort:ready timeout 60 node /opt/cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --patch /ci/ci-issue34-whitebox.yml > "$out/preflight.log" 2>&1
  test -f "$out/whitebox/PREFLIGHT_COMPLETE"
  docker_ci run --name ar34-loop15-$cohort --label acceptance=issue34-20260914 --network none --memory 2g --memory-swap 2g --cpus 2 --pids-limit 256 --user 1000:1000 -v "$lab/$folder/work/user:/work/user:ro" -v "$src/scripts:/ci:ro" -v "$out:/results" ar34/final15-$cohort:ready timeout 60 node /ci/ci-issue34-loop.mjs > "$out/loop.log" 2>&1
  printf '%s FINAL_MATRIX_PASS\n' "$cohort"
done
