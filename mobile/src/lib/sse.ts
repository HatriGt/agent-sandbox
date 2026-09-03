// SSE over XMLHttpRequest. React Native's fetch has no streaming body, and
// EventSource can't send the Authorization header — XHR with incremental
// responseText reads is the reliable path (same protocol as web openSse()).
import { authHeaders } from "./api";
import { serverUrl } from "./config";

export type SseFrame = { event: string; data: string; id?: string };

export type SseHandle = { close: () => void };

export function openSse(
  path: string,
  opts: {
    lastEventId?: string;
    onFrame: (f: SseFrame) => void;
    onError: (err: Error) => void;
    onDone?: () => void;
  },
): SseHandle {
  const xhr = new XMLHttpRequest();
  let closed = false;
  let seen = 0;
  let buffer = "";

  xhr.open("GET", `${serverUrl()}${path}`);
  const headers = authHeaders();
  for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
  xhr.setRequestHeader("accept", "text/event-stream");
  if (opts.lastEventId) xhr.setRequestHeader("last-event-id", opts.lastEventId);

  const pump = () => {
    const text = xhr.responseText ?? "";
    if (text.length <= seen) return;
    buffer += text.slice(seen);
    seen = text.length;
    // Frames are separated by a blank line.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // heartbeat comment
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
      }
      if (data.length || event !== "message") opts.onFrame({ event, data: data.join("\n"), id });
    }
  };

  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState === 3) pump();
    if (xhr.readyState === 4) {
      pump();
      if (xhr.status >= 200 && xhr.status < 300) opts.onDone?.();
      else opts.onError(new Error(`sse ${xhr.status || "network error"}`));
    }
  };
  xhr.onerror = () => {
    if (!closed) opts.onError(new Error("sse network error"));
  };
  xhr.send();

  return {
    close: () => {
      closed = true;
      try {
        xhr.abort();
      } catch {
        /* already closed */
      }
    },
  };
}
