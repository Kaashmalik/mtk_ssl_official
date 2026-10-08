#!/usr/bin/env bash
# ============================================================================
# SSL Cricket — legacy entrypoint
#
# The maintained VPS deployment script is deploy-vps.sh. This file remains only
# as a compatibility shim so older runbooks and muscle memory keep working.
# It forwards all arguments and then exits with that script's status.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/deploy-vps.sh"

if [[ ! -f "$TARGET" ]]; then
  echo "ERROR: deploy-vps.sh not found next to this script." >&2
  exit 1
fi

echo "NOTE: deploy.sh is deprecated — delegating to deploy-vps.sh"
echo "Usage: bash deploy-vps.sh [--phase core|all|infra|frontend]"
echo ""

exec bash "$TARGET" "$@"
