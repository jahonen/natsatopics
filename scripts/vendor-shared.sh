#!/usr/bin/env bash
# Packs the @natsatopics/shared workspace package into a tarball inside
# functions/vendor/ and web/vendor/ so it's self-contained within each's own
# source directory. Firebase Cloud Build (both Cloud Functions and App
# Hosting, the latter with apphosting.yaml's rootDir set to web/) only
# uploads that single directory in isolation — npm workspace symlinks to
# packages/shared aren't available there — so a local tarball dependency
# (each package.json's "file:./vendor/natsatopics-shared.tgz") is what
# actually gets installed during the cloud build.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build -w packages/shared

vendor_into() {
  local TARGET_DIR="$1"
  local VENDOR_DIR="$ROOT_DIR/$TARGET_DIR/vendor"
  mkdir -p "$VENDOR_DIR"
  rm -f "$VENDOR_DIR"/natsatopics-shared*.tgz

  local TARBALL_NAME
  TARBALL_NAME=$(npm pack ./packages/shared --pack-destination "$VENDOR_DIR" --silent | tail -n 1)
  mv "$VENDOR_DIR/$TARBALL_NAME" "$VENDOR_DIR/natsatopics-shared.tgz"

  # <target>/package-lock.json pins the tarball's integrity hash from
  # whenever it was last generated. Since this tarball's content (and
  # therefore hash) changes on every rebuild, a stale lockfile makes the
  # very next isolated `npm install` fail with EINTEGRITY "seems to be
  # corrupted" — so it must be regenerated every time too.
  rm -f "$ROOT_DIR/$TARGET_DIR/package-lock.json"
  rm -rf "$ROOT_DIR/$TARGET_DIR/node_modules/@natsatopics"

  echo "Vendored @natsatopics/shared -> $TARGET_DIR/vendor/natsatopics-shared.tgz"
}

vendor_into functions
vendor_into web
