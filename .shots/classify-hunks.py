"""Tag each changed hunk with the round-6 workstream its added/removed lines belong to.

Usage: python -I .shots/classify-hunks.py <git diff output file>
Prints per-file: hunk index -> workstream tags, so single-stream files can be `git add`ed whole and
mixed files split with .shots/split-hunks.py.
"""
import re
import sys

SIGNS = {
    "wording": re.compile(r"action needed|needs? action|needs?[- ]you|need your|waiting|Action needed|action-needed|attention", re.I),
    "glow": re.compile(r"ring-live|mic-live|mic-glow|composer-focus|composer-glow|attention-glow|attention-pulse|data-thread|orb|think-orb|agent-mark|viz-pulse|box-shadow|radial-gradient|border-live|breathe|bloom|halo|glow", re.I),
    "icons": re.compile(r"iconTheme|vscodeIcons|FolderIcon|FileIcon|FileMark|variant=\"icon\"|data-file-kind|TREE = \[", re.I),
    "themes": re.compile(r"data-theme|\bnord\b|\bforest\b|\bdusk\b|\bmist\b|Popover|preview\.|ThemeId|radiogroup|miniature|THEMES|asb-theme|theme", re.I),
}

text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
files = re.split(r"^(?=diff --git )", text, flags=re.M)
for f in files:
    if not f.startswith("diff --git"):
        continue
    name = re.search(r"^\+\+\+ b/(.*)$", f, re.M)
    name = name.group(1) if name else re.search(r"diff --git a/(\S+)", f).group(1)
    hunks = re.split(r"^(?=@@ )", f, flags=re.M)[1:]
    tags = []
    for i, h in enumerate(hunks, 1):
        body = "\n".join(l[1:] for l in h.splitlines() if l[:1] in "+-" and not l.startswith(("+++", "---")))
        t = [k for k, rx in SIGNS.items() if rx.search(body)]
        tags.append((i, t or ["?"]))
    streams = {x for _, t in tags for x in t}
    flag = "MIXED" if len(streams) > 1 else "single"
    print(f"{flag:6} {name} :: " + " ".join(f"{i}={'/'.join(t)}" for i, t in tags))
