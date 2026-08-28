import * as React from "react";
import { ArrowUpRight, CircleDot, FileCode2, GitCommitHorizontal, GitPullRequest, Github, Globe, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A URL in prose, rendered as a compact chip instead of a raw address: an icon for what it points
 * at, a short human label, and an arrow. GitHub gets first-class treatment (PR, issue, commit, file,
 * repo); anything else shows its host and first path segment. When the author gave the link its own
 * text (`[like this](url)`), that text wins and only the icon/arrow are added.
 */
type Kind = "pr" | "issue" | "commit" | "file" | "repo" | "github" | "web";

export function describeUrl(href: string): { kind: Kind; label: string; title: string } {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { kind: "web", label: href, title: href };
  }
  const host = u.hostname.replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" && segs.length >= 2) {
    const repo = `${segs[0]}/${segs[1]}`;
    const [, , kind, ...rest] = segs;
    if (kind === "pull" && rest[0]) return { kind: "pr", label: `${segs[1]}#${rest[0]}`, title: `Pull request #${rest[0]} · ${repo}` };
    if (kind === "issues" && rest[0]) return { kind: "issue", label: `${segs[1]}#${rest[0]}`, title: `Issue #${rest[0]} · ${repo}` };
    if (kind === "commit" && rest[0]) return { kind: "commit", label: `${segs[1]}@${rest[0].slice(0, 7)}`, title: `Commit ${rest[0]} · ${repo}` };
    if ((kind === "blob" || kind === "tree") && rest.length >= 2) {
      const path = rest.slice(1).join("/");
      const base = path.split("/").pop() || path;
      return { kind: "file", label: base, title: `${repo} · ${path}` };
    }
    if (!kind) return { kind: "repo", label: repo, title: `${repo} on GitHub` };
    return { kind: "github", label: `${repo}/${kind}`, title: href };
  }
  const first = segs[0] ? `/${segs[0]}${segs.length > 1 ? "/…" : ""}` : "";
  return { kind: "web", label: `${host}${first}`, title: href };
}

const ICONS: Record<Kind, React.ComponentType<{ className?: string }>> = {
  pr: GitPullRequest,
  issue: CircleDot,
  commit: GitCommitHorizontal,
  file: FileCode2,
  repo: Github,
  github: Github,
  web: Globe,
};

export function LinkChip({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) {
  const d = describeUrl(href);
  const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
  // `[text](url)` keeps its text; a bare/autolinked URL gets the short label.
  const custom = text && text !== href && text.replace(/\/$/, "") !== href.replace(/\/$/, "");
  const Icon = custom && d.kind === "web" ? LinkIcon : ICONS[d.kind];
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={d.title}
      className={cn(
        "bg-muted hover:bg-accent text-foreground inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px align-[-0.12em] text-[0.9em] leading-[1.35] font-medium no-underline transition-colors",
        d.kind === "pr" && "text-ok",
        d.kind === "issue" && "text-live",
        className
      )}
    >
      <Icon className="size-[0.95em] shrink-0 opacity-80" aria-hidden />
      <span className="truncate">{custom ? children : d.label}</span>
      <ArrowUpRight className="text-muted-foreground size-[0.85em] shrink-0" aria-hidden />
    </a>
  );
}
