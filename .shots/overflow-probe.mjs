import { readFile } from "node:fs/promises";

// A worktree's node_modules is a link into the main checkout, outside Vite's fs allow list, so the
// self-hosted fonts 403 and every text width is measured in a fallback face. Serve them from disk.
export async function serveWorktreeFonts(ctx) {
  await ctx.route(/\/@fs\/.*\.woff2?$/, async (route) => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/@fs\//, ""));
    try {
      route.fulfill({ status: 200, contentType: "font/woff2", body: await readFile(file) });
    } catch {
      route.continue();
    }
  });
}

// Finds what would show a horizontal scrollbar or spill past the viewport on a narrow screen.
export async function auditOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const label = (el) => {
      const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
    };
    const path = (el) => {
      const parts = [];
      for (let n = el, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) parts.unshift(label(n));
      return parts.join(" > ");
    };
    const out = [];
    const seen = new Set();
    // Content past the viewport but inside a scroll container that is itself in view is reachable by
    // scrolling that container; it is that container's `scrollbar` entry, not a spill.
    const scrolledInto = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if ((o === "auto" || o === "scroll") && n.getBoundingClientRect().right <= vw + 1) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const scrolls = (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
      const spills = r.right > vw + 1 && cs.position !== "fixed" && cs.position !== "absolute" && !scrolledInto(el);
      if (!scrolls && !spills) continue;
      const key = path(el);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: scrolls ? "scrollbar" : "spill", by: Math.round(scrolls ? el.scrollWidth - el.clientWidth : r.right - vw), path: key });
    }
    const doc = document.scrollingElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.unshift({ kind: "page", by: doc.scrollWidth - doc.clientWidth, path: "document" });
    return out;
  });
}

// Every DataTable's column widths as laid out: `<aria-label>: id=width …` so a wrong column shows as a number.
export async function dumpTables(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("table[data-slot=table]")).map((t) => {
      const cols = Array.from(t.querySelectorAll("col")).map((c) => `${c.dataset.col ?? "?"}=${c.style.width || c.className || "-"}`);
      const ths = Array.from(t.tHead?.rows[0]?.cells ?? []).map((th) => `${th.textContent.trim().slice(0, 10) || "·"}:${Math.round(th.getBoundingClientRect().width)}`);
      return `${t.getAttribute("aria-label")} table=${Math.round(t.getBoundingClientRect().width)}/${Math.round(t.parentElement.getBoundingClientRect().width)}  cols[${cols.join(" ")}]  ths[${ths.join(" ")}]`;
    })
  );
}
