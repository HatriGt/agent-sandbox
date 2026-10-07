import * as React from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { FileMark } from "@/lib/fileIcon";
import { DataTable, type Column } from "@/components/ui/data-table";

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

const COLUMNS: Column<Row>[] = [
  {
    id: "path",
    primary: true,
    header: "File",
    sort: (r) => r.path,
    cell: (r) => {
      const cut = r.path.lastIndexOf("/");
      const dir = r.path.slice(0, Math.max(0, cut));
      return (
        <span className="flex min-w-0 items-center gap-2">
          <FileMark path={r.path} />
          <span className="text-foreground truncate font-mono text-micro">{r.path.slice(cut + 1)}</span>
          {dir && <span className="text-faint hidden truncate text-micro sm:inline">{dir}</span>}
        </span>
      );
    },
  },
  { id: "bytes", header: "Size", align: "end", width: "w-24", sort: (r) => r.bytes, cell: (r) => <span className="text-muted-foreground font-mono text-micro">{fmtBytes(r.bytes)}</span> },
  { id: "mtime", header: "Modified", align: "end", width: "w-28", sort: (r) => r.mtime, cell: (r) => <span className="text-muted-foreground text-micro">{fmtAgo(r.mtime)}</span> },
];

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordsTable({ session, onOpen }: { session: string; onOpen: (path: string) => void }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
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
    return q ? (rows ?? []).filter((r) => r.path.toLowerCase().includes(q)) : (rows ?? []);
  }, [rows, query]);

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
      {error ? (
        <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-3 *:data-[slot=table-frame]:flex *:data-[slot=table-frame]:min-h-0 *:data-[slot=table-frame]:flex-col">
          <DataTable
            aria-label="Workspace files"
            rows={shown}
            columns={COLUMNS}
            rowKey={(r) => r.path}
            onRowClick={(r) => onOpen(r.path)}
            rowLabel={(r) => `Open ${r.path}`}
            initialSort={{ id: "mtime", dir: "desc" }}
            loading={rows === null}
            empty={query ? "No files match." : "No files."}
            size="sm"
            stickyHeader
            containerClassName="min-h-0"
          />
        </div>
      )}
    </div>
  );
}
