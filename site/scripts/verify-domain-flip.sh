#!/usr/bin/env bash
# verify-domain-flip.sh — Post-flip smoke for custom-domain rollout (P6 Phase G)
#
# Usage:
#   ./verify-domain-flip.sh <new-domain> [<old-workers-dev-host>]
#
# Example:
#   ./verify-domain-flip.sh ai.sshadows.dk centralgauge.sshadows.workers.dev
#
# Both arguments are bare hostnames (no scheme, no path). The script
# constructs `https://${HOST}/` URLs internally so the operator never
# has to remember the right delimiter.
#
# Exit code 0: all checks passed.
# Exit code != 0: at least one check failed; see stderr for diagnostics.

set -euo pipefail

NEW="${1:?Usage: $0 <new-domain> [<old-workers-dev-host>]}"
OLD="${2:-centralgauge.sshadows.workers.dev}"

PASS=0
FAIL=0
log_pass() { echo "[PASS] $*"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $*" >&2; FAIL=$((FAIL+1)); }

echo "=== Verifying custom-domain flip: ${NEW} (was ${OLD}) ==="

# 1. New domain returns 200 on / with leaderboard markup
home_body="$(curl -sf "https://${NEW}/" || true)"
home_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${NEW}/" || echo '000')"
if [[ "${home_code}" == "200" ]]; then
  log_pass "https://${NEW}/ returns 200"
else
  log_fail "https://${NEW}/ returned HTTP ${home_code} (expected 200)"
fi

# Leaderboard markup probe — the `/` route renders a table with
# data-testid="leaderboard-table" or similar; we just verify the page
# isn't a generic 404 by checking for the canonical site-name token.
if printf '%s' "${home_body}" | grep -qi "centralgauge"; then
  log_pass "Homepage HTML contains 'CentralGauge' brand token"
else
  log_fail "Homepage HTML missing 'CentralGauge' brand token (likely 404 or wrong worker)"
fi

# 2. Canonical link points at the new domain
if printf '%s' "${home_body}" | grep -q "rel=\"canonical\".*https://${NEW}/"; then
  log_pass "Canonical URL on / matches new domain"
else
  log_fail "Canonical URL on / does NOT match new domain"
fi

# 3. New domain sitemap reachable
sitemap_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${NEW}/sitemap.xml" || echo '000')"
if [[ "${sitemap_code}" == "200" ]]; then
  log_pass "https://${NEW}/sitemap.xml returns 200"
else
  log_fail "https://${NEW}/sitemap.xml returned HTTP ${sitemap_code} (expected 200)"
fi

# 4. Sitemap entries reference the new domain
if curl -s "https://${NEW}/sitemap.xml" | grep -q "<loc>https://${NEW}/"; then
  log_pass "Sitemap entries reference new domain"
else
  log_fail "Sitemap entries do NOT reference new domain (still pointing at old?)"
fi

# 5. robots.txt has Sitemap entry pointing at new domain
if curl -s "https://${NEW}/robots.txt" | grep -q "^Sitemap: https://${NEW}/sitemap.xml"; then
  log_pass "robots.txt has Sitemap pointer to new domain"
else
  log_fail "robots.txt does NOT have Sitemap pointer to new domain"
fi

# 6. X-Robots-Tag absent on new domain (i.e., indexable)
xrt="$(curl -s -I "https://${NEW}/" | grep -i '^X-Robots-Tag' || true)"
if [[ -z "${xrt}" ]]; then
  log_pass "No X-Robots-Tag on / (page is indexable)"
else
  log_fail "X-Robots-Tag present on /: ${xrt}"
fi

# 7. Old domain status — accept 200 (still serving) or 301/302 (redirected)
old_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${OLD}/" || echo '000')"
case "${old_code}" in
  301|302)
    redirect_target="$(curl -sI "https://${OLD}/" | grep -i '^location:' | tr -d '\r' | awk '{print $2}')"
    if [[ "${redirect_target}" == https://${NEW}/* || "${redirect_target}" == "https://${NEW}/" ]]; then
      log_pass "Old domain ${OLD}/ redirects (${old_code}) to ${redirect_target}"
    else
      log_fail "Old domain ${OLD}/ redirects (${old_code}) to ${redirect_target} (expected https://${NEW}/...)"
    fi
    ;;
  200)
    log_pass "Old domain ${OLD}/ returns 200 (no redirect rule active — acceptable)"
    ;;
  *)
    log_fail "Old domain ${OLD}/ returned HTTP ${old_code} (expected 200 or 301/302)"
    ;;
esac

echo ""
echo "=== Verification: ${PASS} passed, ${FAIL} failed ==="
[[ "${FAIL}" == "0" ]] || exit 1
