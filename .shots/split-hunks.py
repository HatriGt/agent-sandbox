"""Emit a patch holding only the chosen hunks of one file from a `git diff` output.

Usage: python -I .shots/split-hunks.py <patch> <path> <1-based hunk list, e.g. 1,3,5> > out.patch
Then: git apply --cached out.patch
"""
import re
import sys

patch, path, picks = sys.argv[1], sys.argv[2], {int(x) for x in sys.argv[3].split(",")}
text = open(patch, encoding="utf-8", errors="surrogateescape", newline="").read()
for f in re.split(r"(?=^diff --git )", text, flags=re.M):
    if not f.startswith(f"diff --git a/{path} b/{path}"):
        continue
    parts = re.split(r"(?=^@@ )", f, flags=re.M)
    header, hunks = parts[0], parts[1:]
    chosen = [h for i, h in enumerate(hunks, 1) if i in picks]
    missing = picks - set(range(1, len(hunks) + 1))
    if missing:
        sys.exit(f"no such hunks {sorted(missing)}; file has {len(hunks)}")
    sys.stdout.buffer.write((header + "".join(chosen)).encode("utf-8", "surrogateescape"))
    break
else:
    sys.exit(f"{path} not in {patch}")
