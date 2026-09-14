#!/bin/sh
set -eu
: "${DSH_VERSION:?}"
: "${ARTIFACT:?}"
export PATH=/opt/cli/bin:$PATH
export HOME=/work/user
export DSH_HOME=/work/user/.dsh
export npm_config_cache=/work/npm-cache
export npm_config_registry=https://registry.npmmirror.com
export DSH_TELEMETRY_DISABLED=1
mkdir -p /work/results "$HOME"
node --version > /work/results/node-version.txt
npm --version > /work/results/npm-version.txt
# First exercise the documented, ordinary install without fixture peer overrides.
if [ "${DSH_EXACT_FAMILY:-0}" = 1 ]; then
  npm install --global --prefix /opt/cli pnpm@10.15.0 --no-audit --no-fund > /work/results/pnpm-install.log 2>&1
  node /ci/ci-issue34-exact-host.mjs > /work/results/dsh-install.log 2>&1
else
  npm install --global --prefix /opt/cli "@deepseek-ai/dsh@$DSH_VERSION" pnpm@10.15.0 --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,fs-ext,node-pty,@google/genai,protobufjs --no-audit --no-fund > /work/results/dsh-install.log 2>&1
fi
chown -R node:node /work
dsh --version > /work/results/dsh-version.log 2>&1
su -s /bin/sh node -c "HOME=/work/user DSH_HOME=/work/user/.dsh PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin dsh plugin --profile web add '$ARTIFACT' --registry=https://registry.npmmirror.com" > /work/results/plugin-install.log 2>&1
su -s /bin/sh node -c 'HOME=/work/user DSH_HOME=/work/user/.dsh PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin dsh --profile web --dump-config' > /work/results/effective-config.yml 2> /work/results/dump-stderr.log
printf 'INSTALL_COMPLETE\n' > /work/results/install-status
