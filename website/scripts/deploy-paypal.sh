#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-freeteam-ecs}"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
remote_base=/opt/shengyue-paypal

npm --prefix paypal ci --omit=dev --ignore-scripts
npm run test:paypal
ssh "$target" "test -x /opt/shengyue-node/bin/node && mkdir -p '$remote_base/releases/$release_id'"
rsync -az paypal/*.mjs paypal/product.json paypal/package.json paypal/package-lock.json paypal/.env.example deploy/paypal.locations.conf deploy/shengyue-paypal.service \
  "$target:$remote_base/releases/$release_id/"
rsync -az paypal/node_modules/ "$target:$remote_base/releases/$release_id/node_modules/"
rsync -az ../desktop/license.cjs "$target:$remote_base/releases/$release_id/license-core.cjs"
rsync -az ../shared/compatibility-report.cjs ../shared/license-public.pem "$target:$remote_base/releases/$release_id/"

ssh "$target" bash -s -- "$release_id" <<'REMOTE'
set -euo pipefail
base=/opt/shengyue-paypal
release_id="$1"
release="$base/releases/$release_id"
backup="/root/backups/shengyue-paypal-$release_id"
site=/www/server/panel/vhost/nginx/shengyue.conf
nginx=/www/server/nginx/sbin/nginx
mkdir -p "$backup" /etc/shengyue
cp -a "$site" "$backup/shengyue.conf"
for config in /etc/shengyue/paypal.locations.conf /etc/systemd/system/shengyue-paypal.service; do
  if [ -f "$config" ]; then cp -a "$config" "$backup/"; fi
done
id shengyue-paypal >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin shengyue-paypal
install -d -m 700 -o shengyue-paypal -g shengyue-paypal /var/lib/shengyue-paypal
if [ ! -f /etc/shengyue-paypal.env ]; then install -m 600 "$release/.env.example" /etc/shengyue-paypal.env; fi
if [ -L "$base/current" ] && systemctl is-active --quiet shengyue-paypal; then
  ln -sfn "$(readlink "$base/current")" "$base/previous.next"
  mv -Tf "$base/previous.next" "$base/previous"
fi
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
chmod -R a+rX "$release"
install -m 644 "$release/shengyue-paypal.service" /etc/systemd/system/shengyue-paypal.service
systemctl daemon-reload
systemctl enable shengyue-paypal
systemctl restart shengyue-paypal
ready=false
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 3 http://127.0.0.1:3087/api/paypal/healthz; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  journalctl -u shengyue-paypal -n 20 --no-pager
  if [ -L "$base/previous" ]; then
    ln -s "$(readlink "$base/previous")" "$base/rollback.next"
    mv -Tf "$base/rollback.next" "$base/current"
    systemctl restart shengyue-paypal
  fi
  exit 1
fi
install -m 644 "$release/paypal.locations.conf" /etc/shengyue/paypal.locations.conf
# Patch only this site's HTTPS server; preserve all other live site settings.
python3 - "$site" <<'PY'
import pathlib, sys
file = pathlib.Path(sys.argv[1])
text = file.read_text()
include = '    include /etc/shengyue/paypal.locations.conf;\n\n'
if include not in text:
    anchor = '    location = /healthz {'
    if text.count(anchor) != 1:
        raise SystemExit('Cannot locate unique healthz location; refusing to change nginx config')
    file.write_text(text.replace(anchor, include + anchor))
PY
if ! "$nginx" -t; then
  cp -a "$backup/shengyue.conf" "$site"
  if [ -f "$backup/paypal.locations.conf" ]; then cp -a "$backup/paypal.locations.conf" /etc/shengyue/paypal.locations.conf; fi
  exit 1
fi
"$nginx" -s reload
systemctl is-active shengyue-paypal
echo "PayPal service deployed: $release_id; configuration backup: $backup"
REMOTE

curl -fsS --max-time 15 https://voice.freeteam.top/api/paypal/healthz
