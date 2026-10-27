#!/usr/bin/env bash
# Build and push the mcp-gateway image via `az acr build`, without letting
# `az acr build`'s local-directory packer upload the whole monorepo.
#
# WHY THIS SCRIPT EXISTS, NOT A BARE `az acr build ... .`:
# `az acr build <local-dir>` packs and uploads the ENTIRE given directory to
# the registry's build service before Docker ever sees it - a repo-root
# `.dockerignore` does NOT reduce this upload; it (at best) only affects a
# real `docker build`'s own COPY-time filtering, not az acr build's packer.
# Measured live on this repo: `az acr build ... .` from the repo root
# uploaded 726 MiB (including the real secret file `plugins/atlas/.env` and
# a 47 MB macOS-only stale Python venv under `plugins/armada/mcp/falcon/`)
# even with a root `.dockerignore` in place; staging only the files this
# Dockerfile actually needs into a scratch directory first drops that to
# 1.88 MiB. For a GLBA/Reg-S-P-regulated deployment, "the build pipeline
# never receives files it doesn't need" is not optional.
#
# Usage: mcp_servers/mcp-gateway/scripts/acr-build.sh [registry] [resource-group] [subscription]
#   Each value may instead come from ACR_REGISTRY, ACR_RESOURCE_GROUP and
#   ACR_SUBSCRIPTION. There are no defaults; the script refuses to run
#   without all three. Optional: IMAGE_TAG (default: latest).
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: acr-build.sh [registry] [resource-group] [subscription]
  or set ACR_REGISTRY, ACR_RESOURCE_GROUP and ACR_SUBSCRIPTION.
All three are required; there are no defaults. Optional: IMAGE_TAG (default: latest).
USAGE
}

REGISTRY="${1:-${ACR_REGISTRY:-}}"
RESOURCE_GROUP="${2:-${ACR_RESOURCE_GROUP:-}}"
SUBSCRIPTION="${3:-${ACR_SUBSCRIPTION:-}}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
if [ -z "$REGISTRY" ] || [ -z "$RESOURCE_GROUP" ] || [ -z "$SUBSCRIPTION" ]; then
  echo "acr-build.sh: registry, resource group and subscription are required." >&2
  usage
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GATEWAY_DIR/../.." && pwd)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/mcp_servers/mcp-gateway" "$STAGE/plugins/armada"

cp "$GATEWAY_DIR/Dockerfile" "$GATEWAY_DIR/package.json" "$GATEWAY_DIR/package-lock.json" "$GATEWAY_DIR/tsconfig.json" \
  "$STAGE/mcp_servers/mcp-gateway/"
cp -R "$GATEWAY_DIR/src" "$STAGE/mcp_servers/mcp-gateway/src"
cp -R "$GATEWAY_DIR/catalog" "$STAGE/mcp_servers/mcp-gateway/catalog"
mkdir -p "$STAGE/mcp_servers/mcp-gateway/scripts"
cp "$GATEWAY_DIR/scripts/gen-jwks.mjs" "$STAGE/mcp_servers/mcp-gateway/scripts/"

cp -R "$REPO_ROOT/plugins/armada/mcp" "$STAGE/plugins/armada/mcp"
rm -rf "$STAGE/plugins/armada/mcp/falcon/.venv" "$STAGE/plugins/armada/mcp/falcon/.venv.nosync.noindex"
find "$STAGE" -name ".env" -delete
find "$STAGE" -name "__pycache__" -type d -prune -exec rm -rf {} +

echo "Staged build context: $(du -sh "$STAGE" | cut -f1) (must NOT include plugins/atlas/.env or a falcon venv)"
if find "$STAGE" -iname "*.env" -o -iname "*.venv*" | grep -q .; then
  echo "REFUSING TO BUILD: staged context still contains an .env or .venv path:" >&2
  find "$STAGE" -iname "*.env" -o -iname "*.venv*" >&2
  exit 1
fi

az acr build \
  --registry "$REGISTRY" \
  --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION" \
  --image "mcp-gateway:$IMAGE_TAG" \
  --file mcp_servers/mcp-gateway/Dockerfile \
  "$STAGE"

echo "Built and pushed. To deploy: get the digest and redeploy the Container App by exact digest + a new --revision-suffix (a bare tag update does not roll a new revision):"
echo "  az acr repository show --name $REGISTRY --image "mcp-gateway:$IMAGE_TAG" --query digest -o tsv"
