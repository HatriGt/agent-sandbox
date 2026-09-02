import * as React from "react";
import { ArrowDown, ArrowUp, Loader2, RefreshCw, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { FileMark } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";

/**
 * The workspace as a records table — every file with type mark, size and modified time, sortable by
 * any column. Sorting by "modified" answers the operator's real question ("what did the agent just
 * touch?") in one click; the tree view cannot. Rows stagger in on first load; click opens the file
 * in the editor. Data comes from /tree.json?details=1 (same exclusions and cap as the tree).
 */

interface Row {
  path: string;
  bytes: number;
  mtime: number;
}

type SortKey = "path" | "bytes" | "mtime";

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordsTable({ session, onOpen }: { session: string; onOpen: (path: string) => void }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: "mtime", dir: -1 });
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.treeDetails(session);
      setRows(r.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);
  React.useEffect(() => {
    void load();
  }, [load]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? (rows ?? []).filter((r) => r.path.toLowerCase().includes(q)) : (rows ?? []);
    return [...filtered].sort((a, b) => {
      const d = sort.key === "path" ? a.path.localeCompare(b.path) : a[sort.key] - b[sort.key];
      return d * sort.dir;
    });
  }, [rows, query, sort]);

  const header = (key: SortKey, label: string, right?: boolean) => {
    const on = sort.key === key;
    return (
      <th className={cn("px-3 py-1.5", right && "text-right")}>
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "path" ? 1 : -1 }))}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 text-micro font-medium",
            on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
        >
          {label}
          {on && (sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <label className="bg-card flex h-7 min-w-0 flex-1 max-w-72 items-center gap-1.5 rounded-md border px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <span className="text-muted-foreground text-micro tabular-nums">
          {shown.length} {shown.length === 1 ? "file" : "files"}
        </span>
        <button type="button" onClick={() => void load()} aria-label="Refresh" className="text-muted-foreground hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-md">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : rows === null ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer h-4 rounded" style={{ animationDelay: `${i * 0.1}s`, width: `${85 - i * 9}%` }} />
            ))}
          </div>
        ) : (
          <table className="w-full border-collapse text-meta">
            <thead>
              <tr className="bg-background sticky top-0 z-10 border-b text-left">
                {header("path", "File")}
                {header("bytes", "Size", true)}
                {header("mtime", "Modified", true)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const base = r.path.slice(r.path.lastIndexOf("/") + 1);
                const dir = r.path.slice(0, Math.max(0, r.path.lastIndexOf("/")));
                return (
                  <motion.tr
                    key={r.path}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, delay: Math.min(i, 14) * 0.02 }}
                    onClick={() => onOpen(r.path)}
                    className="hover:bg-muted/60 cursor-pointer border-b border-border/50 last:border-0"
                  >
                    <td className="max-w-0 px-3 py-1.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileMark path={r.path} />
                        <span className="text-foreground truncate font-mono text-micro">{base}</span>
                        {dir && <span className="text-faint hidden truncate text-micro sm:inline">{dir}</span>}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-1.5 text-right font-mono text-micro whitespace-nowrap tabular-nums">{fmtBytes(r.bytes)}</td>
                    <td className="text-muted-foreground px-3 py-1.5 text-right text-micro whitespace-nowrap tabular-nums">{fmtAgo(r.mtime)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
