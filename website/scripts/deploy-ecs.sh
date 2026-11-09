#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
target="${1:-freeteam-ecs}"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
remote_base=/var/www/shengyue

npm run prepare:downloads
npm run build
npm run test:sites
npm run test:seo
npm run test:analytics

release_version="$(node -p "require('./src/release.json').version")"
# Seed a private staging directory from the nearest existing installers so rsync
# can reuse unchanged Electron payloads without exposing an unfinished download.
ssh "$target" bash -s -- "$release_id" "$release_version" <<'SEED'
set -euo pipefail
base=/var/www/shengyue
stage="$base/staging/$1"
version="$2"
mkdir -p "$base/releases/$1" "$base/shared/downloads" "$stage"
for suffix in mac-arm64.dmg mac-arm64.zip mac-x64.dmg mac-x64.zip windows-setup.exe win-x64.zip; do
    source=""
    for candidate in "$base/shared/downloads"/Shengyue-*-$suffix; do
        if [ -f "$candidate" ]; then source="$candidate"; fi
    done
    if [ -n "$source" ]; then cp -p "$source" "$stage/Shengyue-$version-$suffix"; fi
done
SEED
rsync -az --partial --checksum dist/client/downloads/ "$target:$remote_base/staging/$release_id/"
rsync -az --exclude=/downloads/ dist/client/ "$target:$remote_base/releases/$release_id/"

ssh "$target" bash -s -- "$release_id" <<'REMOTE'
set -euo pipefail
base=/var/www/shengyue
release_id="$1"
test -s "$base/releases/$release_id/index.html"
stage="$base/staging/$release_id"
cd "$stage"
sha256sum -c SHA256SUMS.txt
# Publish each verified installer by rename on the same filesystem. Preserve
# older versions for users following existing links and for website rollback.
for file in Shengyue-*.dmg Shengyue-*.zip Shengyue-*.exe; do
    if [ -f "$file" ]; then mv -f "$file" "$base/shared/downloads/"; fi
done
mv -f SHA256SUMS.txt "$base/shared/downloads/"
cd "$base"
rmdir "$stage"
chmod -R a+rX "$base/releases/$release_id" "$base/shared/downloads"
if [ -L "$base/current" ]; then
    ln -sfn "$(readlink "$base/current")" "$base/previous.next"
    mv -Tf "$base/previous.next" "$base/previous"
fi
ln -s "$base/releases/$release_id" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
echo "Published $release_id"
REMOTE

# A search notification failure must not roll back an otherwise healthy release.
if ! npm run seo:submit; then
    echo "Website published; IndexNow notification did not complete. See .qa/seo/ and retry npm run seo:submit."
fi
if ! npm run seo:submit:baidu; then
    echo "Website published; Baidu did not confirm URL acceptance. See .qa/seo/baidu-submission.json."
fi
