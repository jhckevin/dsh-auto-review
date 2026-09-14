#!/bin/sh
set -eu
: "${COHORT:?}" "${TASK_PATH:?}"
export PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin
export HOME=/work/user DSH_HOME=/work/user/.dsh DSH_TELEMETRY_DISABLED=1
export DEEPSEEK_API_KEY=ci-proxy-placeholder DEEPSEEK_BASE_URL=http://127.0.0.1:8099
export DSH_AUTO_REVIEW_NATIVE_RUNTIME=/opt/dsh-auto-review-native/0.1.0-rc.2/node_modules/@jhckevin/dsh-auto-review-bridge-linux-x64-gnu
node /ci/ci-flash-forward.mjs /gateway.sock "$COHORT" &
forward=$!
trap 'kill "$forward" 2>/dev/null || true' EXIT
# Wait for the local transport, not the model. This performs no paid request.
node -e 'for(let i=0;i<100;i++){try{await fetch("http://127.0.0.1:8099/health");process.exit(0)}catch{await new Promise(r=>setTimeout(r,50))}}process.exit(1)'
if [ "${WHITEBOX:-0}" = 1 ]; then
  timeout --signal=TERM --kill-after=15s 900 node /opt/cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --patch /ci/ci-issue34-whitebox.yml
else
  task=$(cat "$TASK_PATH")
  timeout --signal=TERM --kill-after=15s 900 node /opt/cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless --patch /ci/ci-flash-config.yml "$task"
fi
