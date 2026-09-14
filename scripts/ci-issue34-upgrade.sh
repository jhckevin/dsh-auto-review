#!/bin/sh
set -eu
: "${ARTIFACT:?}"
export HOME=/work/user DSH_HOME=/work/user/.dsh PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin
for profile in web headless; do
  su -s /bin/sh node -c "HOME=/work/user DSH_HOME=/work/user/.dsh PATH=/opt/cli/bin:/usr/local/bin:/usr/bin:/bin dsh plugin --profile $profile add '$ARTIFACT' --registry=https://registry.npmmirror.com"
done
node /work/user/.dsh/profiles/web/node_modules/@jhckevin/dsh-auto-review/scripts/install-ui.mjs --dsh-root /opt/cli/lib/node_modules/@deepseek-ai/dsh/node_modules --profile-root /work/user/.dsh/profiles/web
node /work/user/.dsh/profiles/web/node_modules/@jhckevin/dsh-auto-review/scripts/install-ui.mjs --dsh-root /opt/cli/lib/node_modules/@deepseek-ai/dsh/node_modules --profile-root /work/user/.dsh/profiles/web --check
