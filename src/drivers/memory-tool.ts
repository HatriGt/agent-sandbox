/**
 * `memory` — the box's view into memory across runs (src/memory-store.ts), installed by the
 * bootstrap next to `need` (src/msb.ts). Two verbs, no controller channel:
 *
 *   · memory search <words…>  — greps ~/.claude/MEMORY.md (the relevant slice installMemory wrote
 *     for this turn) and ~/.claude/MEMORY-all.md (every note) case-insensitively, every word must
 *     match, prints the hits with their [kind]. The prompt asks for this before a step the agent has
 *     attempted before — the cheap "you are about to repeat something that failed" check.
 *   · memory add <kind> <text…> [--why <t>] [--replaces <old text>] — appends the sentinel line
 *     `<!-- remember: kind | text | why: … | replaces: "…" -->` to /workspace/.agent.log, where the
 *     controller's incremental harvest picks it up exactly like a line the agent wrote in prose.
 *     Every ⟦ in the text is defanged (U+200B wedged before it) as the follow-up echo does, so a note
 *     can never forge a transcript sentinel. Kinds are validated against the shared list.
 *
 * POSIX sh (the image's /bin/sh is dash). Nothing here reads or prints credentials.
 */
import { AGENT_LOG, MEMORY_KINDS, REMEMBER_CLOSE, REMEMBER_OPEN } from "./sentinels.js";

export const MEMORY_TOOL_PATH = "/usr/local/bin/memory";
/** Where installMemory writes the two files (the claude paths; omp gets copies under ~/.omp). */
export const MEMORY_MD = "/root/.claude/MEMORY.md";
export const MEMORY_ALL_MD = "/root/.claude/MEMORY-all.md";

/** The `memory` script. */
export function memoryToolScript(): string {
  const kinds = MEMORY_KINDS.join(" ");
  return `#!/bin/sh
# memory — search what earlier runs learned, or add a note. See src/drivers/memory-tool.ts.
set -u
LOG=${AGENT_LOG}
MD=${MEMORY_MD}
ALL=${MEMORY_ALL_MD}
KINDS="${kinds}"
usage() {
  cat <<'EOF'
usage: memory search <words...>                       find notes matching every word (case-insensitive)
       memory add <kind> <text...> [--why <text>] [--replaces <old note text>]
                                                      remember something for future runs
kinds: ${kinds}
  lesson     a correction, or an approach you abandoned (say --why)
  preference how the operator wants things in general
  rule       "when X, do Y" standing instruction
  decision   an answered question or a choice future runs must not re-litigate (say --why)
  fact       repo/environment knowledge
  playbook   title then the exact steps that worked, for a task that recurs
Notes land in MEMORY.md on the next run. Never put secrets in a note — name the env var instead.
EOF
}
cmd=\${1:-help}
[ $# -gt 0 ] && shift
case "$cmd" in
  search)
    [ $# -gt 0 ] || { echo "usage: memory search <words...>" >&2; exit 2; }
    t=$(mktemp)
    cat "$MD" "$ALL" 2>/dev/null | grep -- '^- \\[' | sort -u > "$t"
    for w in "$@"; do
      if grep -i -F -- "$w" "$t" > "$t.n"; then mv "$t.n" "$t"; else : > "$t"; rm -f "$t.n"; break; fi
    done
    if [ -s "$t" ]; then cat "$t"; else echo "memory: no note matches: $*"; fi
    rm -f "$t" "$t.n"
    ;;
  add)
    kind=\${1:-}
    [ $# -gt 0 ] && shift
    case " $KINDS " in *" $kind "*) ;; *) echo "memory: kind must be one of: $KINDS" >&2; exit 2;; esac
    text=""; why=""; rep=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --why) [ $# -ge 2 ] || { echo "memory: --why needs a value" >&2; exit 2; }; why=$2; shift 2;;
        --replaces) [ $# -ge 2 ] || { echo "memory: --replaces needs a value" >&2; exit 2; }; rep=$2; shift 2;;
        *) text="$text\${text:+ }$1"; shift;;
      esac
    done
    [ -n "$text" ] || { echo "usage: memory add <kind> <text...> [--why <text>] [--replaces <old text>]" >&2; exit 2; }
    line="${REMEMBER_OPEN} $kind | $text"
    [ -n "$why" ] && line="$line | why: $why"
    [ -n "$rep" ] && line="$line | replaces: \\"$rep\\""
    line="$line ${REMEMBER_CLOSE}"
    # Defang transcript sentinels (⟦, line-leading ●/→) exactly as the follow-up echo does; a
    # playbook's extra lines are indented so the parser reads them as its steps.
    printf '%s\\n' "$line" | sed -e 's/⟦/​⟦/g' -e 's/^●/​●/' -e 's/^→/​→/' -e '2,$s/^/  /' >> "$LOG"
    echo "memory: noted ($kind). It reaches MEMORY.md on the next run."
    ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
`;
}

/** Shell fragment for the bootstrap: install the `memory` tool (idempotent, overwrites). */
export function memorySetup(): string {
  const b64 = Buffer.from(memoryToolScript(), "utf8").toString("base64");
  return `printf '%s' '${b64}' | base64 -d > ${MEMORY_TOOL_PATH} && chmod +x ${MEMORY_TOOL_PATH}`;
}
