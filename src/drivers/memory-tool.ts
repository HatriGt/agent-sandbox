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
       memory areas                                   the knowledge base index: every area of this repo
       memory area <slug>                             one area's page, with its related areas
       memory add <kind> <text...> [--area <part/subpart>] [--paths <a,b>] [--links <area,…>] [--repo owner/name]
                                   [--why <text>] [--replaces <old note text>]
                                                      remember something for future runs
kinds: ${kinds}
  domain     how the product works: an entity, a flow's steps, a business rule, who owns/consumes what
             (always --area, --paths to the code that implements it, --links to related areas;
              --repo when this box has no repo checked out, or several)
  lesson     a correction, or an approach you abandoned (say --why)
  preference how the operator wants things in general
  rule       "when X, do Y" standing instruction
  decision   a choice future runs must not re-litigate (say --why)
  fact       repo/environment knowledge
  playbook   title then the exact steps that worked, for a task that recurs
Writing a note that already exists reaffirms it (clears "unverified"); --replaces rewrites one.
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
  areas)
    cat "$ALL" 2>/dev/null | sed -n '/^## Areas/,/^## /p' | grep -- '^- ' || echo "memory: no areas yet — add a note with --area to start the knowledge base"
    ;;
  area)
    slug=\${1:-}
    [ -n "$slug" ] || { echo "usage: memory area <slug>" >&2; exit 2; }
    t=$(mktemp)
    cat "$MD" "$ALL" 2>/dev/null | grep -- '^- \\[' | sort -u > "$t"
    echo "## $slug"
    grep -F -- " · $slug]" "$t" || echo "memory: no notes in area $slug"
    rel=$(grep -F -- " · $slug]" "$t" | grep -o '{links: [^}]*}' | sed -e 's/{links: //' -e 's/}//' | tr ',' '\\n' | sed 's/^ *//' | sort -u)
    for a in $rel; do
      [ "$a" = "$slug" ] && continue
      echo; echo "## related: $a"
      grep -F -- " · $a]" "$t" || echo "(no notes)"
    done
    rm -f "$t"
    ;;
  add)
    kind=\${1:-}
    [ $# -gt 0 ] && shift
    case " $KINDS " in *" $kind "*) ;; *) echo "memory: kind must be one of: $KINDS" >&2; exit 2;; esac
    text=""; why=""; rep=""; area=""; paths=""; links=""; repo=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --why) [ $# -ge 2 ] || { echo "memory: --why needs a value" >&2; exit 2; }; why=$2; shift 2;;
        --replaces) [ $# -ge 2 ] || { echo "memory: --replaces needs a value" >&2; exit 2; }; rep=$2; shift 2;;
        --area) [ $# -ge 2 ] || { echo "memory: --area needs a value" >&2; exit 2; }; area=$2; shift 2;;
        --paths) [ $# -ge 2 ] || { echo "memory: --paths needs a value" >&2; exit 2; }; paths=$2; shift 2;;
        --links) [ $# -ge 2 ] || { echo "memory: --links needs a value" >&2; exit 2; }; links=$2; shift 2;;
        --repo) [ $# -ge 2 ] || { echo "memory: --repo needs owner/name" >&2; exit 2; }; repo=$2; shift 2;;
        *) text="$text\${text:+ }$1"; shift;;
      esac
    done
    [ -n "$text" ] || { echo "usage: memory add <kind> <text...> [--area <slug>] [--paths <a,b>] [--links <a,b>] [--repo owner/name] [--why <text>] [--replaces <old text>]" >&2; exit 2; }
    [ "$kind" = domain ] && [ -z "$area" ] && { echo "memory: a domain note needs --area <part/subpart> (see: memory areas)" >&2; exit 2; }
    line="${REMEMBER_OPEN} $kind | $text"
    [ -n "$area" ] && line="$line | area: $area"
    [ -n "$paths" ] && line="$line | paths: $paths"
    [ -n "$links" ] && line="$line | links: $links"
    [ -n "$repo" ] && line="$line | repo: $repo"
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
