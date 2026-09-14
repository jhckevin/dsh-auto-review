#!/bin/sh
set -eu
: "${ARTIFACT:?}"
export PATH=/opt/cli/bin:$PATH HOME=/work/user DSH_HOME=/work/user/.dsh
export npm_config_cache=/work/npm-cache npm_config_registry=https://registry.npmmirror.com DSH_TELEMETRY_DISABLED=1
mkdir -p /work/results /opt/dsh-auto-review-native/0.1.0-rc.2
# Administrator-owned execution root, never an agent-writable dependency tree.
npm install --prefix /opt/dsh-auto-review-native/0.1.0-rc.2 --ignore-scripts --no-audit --no-fund "${NATIVE_ARTIFACT:-@jhckevin/dsh-auto-review-bridge-linux-x64-gnu@0.1.0-rc.2}" > /work/results/native-install-retry.log 2>&1
for profile in web headless; do
  su -s /bin/sh node -c "HOME=/work/user DSH_HOME=/work/user/.dsh PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin dsh plugin --profile $profile add '$ARTIFACT' --registry=https://registry.npmmirror.com" > "/work/results/prepare-$profile.log" 2>&1
done
chown -R node:node /work
printf 'PREPARE_COMPLETE\n' > /work/results/prepare-status
