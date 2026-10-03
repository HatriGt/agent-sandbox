// Pure helpers ported from web/src/lib/skillImport.ts (parse a SKILL.md, read a repo reference).
// The GitHub reads go through the controller (`api.skillRepo`) with the same bodies as the web.
import { api } from "@/lib/api";

export interface SkillFile {
  path: string;
  content: string;
}
export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  files?: SkillFile[];
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

export function toSkillName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/skill$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "imported-skill"
  );
}

export function parseSkillMd(text: string, fallbackName: string): ParsedSkill {
  const src = text.replace(/\r\n/g, "\n").trim();
  let name = "";
  let description = "";
  let body = src;

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length).trim();
    const lines = fm[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^(name|description)\s*:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      let v = m[2].trim();
      if (/^[>|][-+]?$/.test(v)) {
        const block: string[] = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
        v = (v.startsWith(">") ? block.join(" ").replace(/\s+/g, " ") : block.join("\n")).trim();
      }
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        try {
          v = v.startsWith('"') ? (JSON.parse(v) as string) : v.slice(1, -1);
        } catch {
          v = v.slice(1, -1);
        }
      }
      if (m[1] === "name") name = v;
      else description = v;
    }
  }

  if (!name || !NAME_RE.test(name)) {
    const h = /^#\s+(.+)$/m.exec(body);
    name = toSkillName(name || h?.[1] || fallbackName);
  }
  if (!description) {
    const firstPara = body.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("```"));
    description = (firstPara ?? `Imported skill ${name}.`).trim().slice(0, 1024);
  }
  return { name, description, content: body || src };
}

export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
}
export interface RepoSkillEntry {
  kind: "dir" | "file";
  path: string;
  name: string;
  fileCount: number;
  totalBytes: number;
}

export function parseRepoInput(input: string): RepoRef {
  const s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const url = /github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^/\s]+)(?:\/([^\s?#]+))?)?/.exec(s);
  if (url) return { owner: url[1], repo: url[2], branch: url[3], subpath: url[4] };
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (short) return { owner: short[1], repo: short[2] };
  throw new Error("Enter a repository as owner/repo or a github.com URL.");
}

export function listRepoSkills(ref: RepoRef) {
  return api.skillRepo<{ branch: string; entries: RepoSkillEntry[]; authed: boolean }>({ action: "list", owner: ref.owner, repo: ref.repo, branch: ref.branch, subpath: ref.subpath });
}
export async function fetchRepoFile(ref: RepoRef, branch: string, path: string): Promise<string> {
  const { text } = await api.skillRepo<{ text: string }>({ action: "fetch", owner: ref.owner, repo: ref.repo, branch, path });
  return text;
}
export function fetchRepoSkill(ref: RepoRef, branch: string, dirPath: string) {
  return api.skillRepo<{ skillMd: string; files: SkillFile[]; skipped: string[] }>({ action: "fetch-skill", owner: ref.owner, repo: ref.repo, branch, path: dirPath });
}

/** Fetch + parse one listed entry into the draft `skillMutate({action:"upsert", skill})` takes. */
export async function loadRepoSkill(ref: RepoRef, branch: string, f: RepoSkillEntry): Promise<ParsedSkill & { skipped?: string[] }> {
  if (f.kind === "dir") {
    const r = await fetchRepoSkill(ref, branch, f.path);
    return { ...parseSkillMd(r.skillMd, f.name), files: r.files, skipped: r.skipped };
  }
  return parseSkillMd(await fetchRepoFile(ref, branch, f.path), f.name);
}
