#!/usr/bin/env bash
# Idempotently insert the /sba location blocks into the host nginx site that
# serves the server IP (market-brief.conf), then test and reload nginx.
set -euo pipefail

CONF="${NGINX_CONF:-/etc/nginx/sites-available/market-brief.conf}"
SNIP="$(cd "$(dirname "$0")" && pwd)/nginx-sba.snippet.conf"

if grep -q "/sba/files" "$CONF"; then
  echo "already-present: /sba blocks exist in $CONF"
  exit 0
fi

BAK="${CONF}.bak.$(date +%s)"
cp "$CONF" "$BAK"
echo "backup=$BAK"

SNIP="$SNIP" CONF="$CONF" python3 - <<'PY'
import os
conf = os.environ["CONF"]
snip = open(os.environ["SNIP"]).read()
s = open(conf).read()
# Indent snippet by 4 spaces to sit inside the server block.
snip_i = "\n".join(("    " + l if l.strip() else l) for l in snip.splitlines())
marker = "    location / {"
i = s.index(marker)
open(conf, "w").write(s[:i] + snip_i + "\n\n" + s[i:])
print("inserted into", conf)
PY

if nginx -t; then
  systemctl reload nginx
  echo "RELOADED"
else
  echo "nginx test FAILED -> restoring $BAK"
  cp "$BAK" "$CONF"
  exit 1
fi
