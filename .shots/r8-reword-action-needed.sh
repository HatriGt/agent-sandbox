#!/usr/bin/env bash
# Round 8 wording: "need you" → "action needed" across the web dashboard, server strings, docs and
# DESIGN.md. Sentence forms run first so "a secret that needs you" becomes "needs action", then the
# state word, then the bare counter. "needs your answer" / "needs your pick" name a specific action
# and are left alone by the [^a-zA-Z] guard. Rerunnable: no output matches any input.
#
#   bash .shots/r8-reword-action-needed.sh        (from the worktree root; mobile/ is not touched)
set -euo pipefail
files=$( { grep -rl -i -E "need(s)? you|needs me" web/src src --include='*.ts' --include='*.tsx' || true; ls docs/*.md web/DESIGN.md; } | sort -u)
for f in $files; do
  sed -E -i \
    -e 's/machines need you/machines need action/g' \
    -e 's/machine needs you/machine needs action/g' \
    -e 's/machine needs me/machine needs action/g' \
    -e 's/something needs me/something needs action/g' \
    -e 's/checkout-svc needs you/checkout-svc needs your answer/g' \
    -e 's/([Nn])othing needs you/\1othing needs action/g' \
    -e 's/anything needs you/anything needs action/g' \
    -e 's/that needs you/that needs action/g' \
    -e 's/still needs you/still needs action/g' \
    -e 's/run needs you/run needs action/g' \
    -e 's/agent needs you/agent needs action/g' \
    -e 's/this needs you/this needs action/g' \
    -e 's/Needs you/Action needed/g' \
    -e 's/needs you([^a-zA-Z]|$)/action needed\1/g' \
    -e 's/\bneed you\b/action needed/g' \
    "$f"
done
echo "rewrote: $(echo "$files" | wc -l) files scanned"
grep -rn -i -E "need(s)? you([^r]|$)|\bneed you\b|needs me|need_you" web/src src docs web/DESIGN.md || echo "no old wording left (needs your … intentionally kept)"

# Hyphenated prose ("the needs-you queue", "amber is for needs-you") in files where it is not an
# identifier. RunInspector's FleetGroup key, push.ts's channel id and index.css (W1's file) are left.
for f in web/src/components/composer/Toolbar.tsx docs/plan-agent-cloud.md web/DESIGN.md; do
  sed -E -i -e 's/Needs-you/Action-needed/g' -e 's/needs-you/action-needed/g' "$f"
done
grep -rn -i "needs-you" web/src src docs web/DESIGN.md | grep -v -E "RunInspector|push.ts|index.css" || echo "no prose needs-you left (identifiers kept)"
