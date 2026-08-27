import { CodeEditor } from "@/components/CodeEditor";

/** The MCP config editor: CodeEditor fixed to JSON. Kept as a named component for its call sites. */
export function JsonEditor(props: { value: string; onChange: (v: string) => void; onSave?: () => void; errorLine?: number | null; minRows?: number; className?: string }) {
  return <CodeEditor {...props} language="json" ariaLabel="MCP configuration JSON" className={props.className ? `rounded-lg border ${props.className}` : "rounded-lg border"} />;
}

/** Line number out of a JSON.parse error message, when the engine gives us a position. */
export function jsonErrorLine(text: string, message: string): number | null {
  const pos = /position (\d+)/i.exec(message);
  if (pos) return text.slice(0, Number(pos[1])).split("\n").length;
  const ln = /line (\d+)/i.exec(message);
  return ln ? Number(ln[1]) : null;
}
