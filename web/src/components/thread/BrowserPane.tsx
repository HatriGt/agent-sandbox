import * as React from "react";
import { ArrowLeft, ArrowRight, Camera, Globe, Loader2, Maximize2, Minimize2, Monitor, RotateCw, Smartphone, SquareDashedMousePointer, StretchHorizontal, TriangleAlert, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, type BrowserPage } from "@/lib/api";
import { useReducedMotion } from "@/lib/motion-pref";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clampTo, defaultPaneWidth, paneRange, type Range } from "@/lib/workspace-model";
import { cn } from "@/lib/utils";
import { areaNote, elementNote, errorsNote, hitTest, sandboxAddress, type MappedElement } from "@/lib/browser-model";

const EASE = [0.22, 1, 0.36, 1] as const;
const STORE_W = "asb-browser-w";
const PHONE = { w: 390, h: 844 };
const STORE_DEVICE = "asb-browser-device";
/** The width a page is laid out at in the desktop view, however narrow the pane is. */
const DESKTOP_W = 1024;
type Device = "desktop" | "fit" | "phone";
/** Keys that go to the page as key presses; everything printable goes as text. */
const PAGE_KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Home", "End", "PageUp", "PageDown"]);

/** What a pick or a screenshot hands to the composer: a picture, with what the agent should know about it. */
export type BrowserTag = { text?: string; image?: { name: string; dataUrl: string; label: string; note: string } };
/** A picture of the page: the viewport plus `top`/`bottom` CSS pixels of page around it. */
type Frame = { src: string; nav: number; top: number; bottom: number };
type Pin = { n: number; url: string; x: number; y: number; w: number; h: number };
type Phase = "starting" | "installing" | "ready" | "error";
type Box = [number, number, number, number];

// A closed pane gives the browser's memory back to the sandbox (about 200 MB of a 1 GB machine),
// but not at once: closing and reopening it should not cost a browser start. The sandbox itself
// declines when the agent is using the page.
const releases = new Map<string, number>();
function releaseSoon(session: string) {
  window.clearTimeout(releases.get(session));
  releases.set(session, window.setTimeout(() => {
    releases.delete(session);
    void api.browser(session, { op: "release", w: 1024, h: 720, dpr: 1 }).catch(() => {});
  }, 45_000));
}
function keep(session: string) {
  window.clearTimeout(releases.get(session));
  releases.delete(session);
}

/**
 * A browser beside the conversation. It runs inside the sandbox (Moli, src/browser.ts), so
 * `localhost` is the dev server the agent started: you look at what it built, and with Select on,
 * a click on any element puts that element (its selector, text, markup and a cropped picture) into
 * your message. What you see is a picture of the page, refreshed after every action; clicks, the
 * wheel and typing are sent to the real page.
 *
 * Two things keep a picture from feeling like one. The wheel moves the current picture at once and
 * the real scroll catches up underneath; and in Select mode the page's element boxes are fetched
 * once per picture, so the highlight follows the pointer with no round trip at all.
 */
export function BrowserPane({
  session,
  live,
  onClose,
  onTag,
  full = false,
  onToggleFull,
  goTo,
  sent = 0,
}: {
  session: string;
  /** The agent is working: re-read the page every few seconds. */
  live: boolean;
  onClose: () => void;
  onTag: (tag: BrowserTag) => void;
  full?: boolean;
  onToggleFull?: () => void;
  /** An address to open, from a link in the conversation. `n` changes per request. */
  goTo?: { url: string; n: number } | null;
  /** Counts messages sent: the elements picked for a message are done with once it is on its way. */
  sent?: number;
}) {
  const still = useReducedMotion();
  const phone = useMediaQuery("(max-width: 767px)");

  // ── pane width (same rule as the workspace: the conversation keeps its minimum) ──
  const paneRef = React.useRef<HTMLElement>(null);
  const [container, setContainer] = React.useState(0);
  React.useLayoutEffect(() => {
    const parent = paneRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setContainer(parent.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const [panePref, setPanePref] = React.useState<number | null>(() => {
    const v = Number(localStorage.getItem(STORE_W));
    return v > 0 ? v : null;
  });
  const [resizing, setResizing] = React.useState(false);
  const range = paneRange(container);
  const width = container ? clampTo(panePref ?? defaultPaneWidth(container), range) : 0;
  const setPaneWidth = (w: number | null) => {
    if (w === null) localStorage.removeItem(STORE_W);
    else localStorage.setItem(STORE_W, String(w));
    setPanePref(w);
  };

  // ── the page ──
  const [phase, setPhase] = React.useState<Phase>("starting");
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState<BrowserPage | null>(null);
  const [frame, setFrame] = React.useState<Frame | null>(null);
  const [under, setUnder] = React.useState<Frame | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [address, setAddress] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [device, setDeviceState] = React.useState<Device>(() => {
    const v = localStorage.getItem(STORE_DEVICE);
    return v === "fit" || v === "phone" ? v : "desktop";
  });
  const setDevice = (d: Device) => {
    localStorage.setItem(STORE_DEVICE, d);
    setDeviceState(d);
  };
  const [select, setSelect] = React.useState(false);
  const [map, setMap] = React.useState<MappedElement[]>([]);
  const [hover, setHover] = React.useState(-1);
  const [pins, setPins] = React.useState<Pin[]>([]);
  const [ripple, setRipple] = React.useState<{ x: number; y: number; n: number } | null>(null);
  const [offset, setOffset] = React.useState(0);

  // ── the stage: the page is laid out at exactly the size it is shown ──
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const framed = device === "phone" && stage.w > PHONE.w + 32;
  // Desktop: the page is laid out 1024 wide, as on a small laptop, and shown smaller to fit the pane. A
  // pane is about half a window; laid out at that width most sites fall back to their tablet or
  // phone layout, which reads as "zoomed in". `zoom` is how much smaller the page is shown.
  const zoom = device === "desktop" && !phone && stage.w > 0 && stage.w < DESKTOP_W ? stage.w / DESKTOP_W : 1;
  const view = React.useMemo(
    () =>
      framed
        ? { w: PHONE.w, h: Math.max(240, Math.min(PHONE.h, stage.h - 32)) }
        : zoom < 1
          ? { w: DESKTOP_W, h: Math.min(2400, Math.max(240, Math.round(stage.h / zoom))) }
          : { w: Math.max(320, stage.w), h: Math.max(240, stage.h) },
    [framed, zoom, stage.w, stage.h]
  );
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  // Refs the action queue reads at run time, so a queued action sees the latest values.
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const selectRef = React.useRef(select);
  selectRef.current = select;
  const pageRef = React.useRef(page);
  pageRef.current = page;
  const hashRef = React.useRef("");
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    keep(session);
    return () => {
      alive.current = false;
      releaseSoon(session);
    };
  }, [session]);
  const chain = React.useRef<Promise<unknown>>(Promise.resolve());
  const target = React.useRef(0); // where the person has scrolled to, ahead of the page
  const wheelSeq = React.useRef(0);
  const scrollQueued = React.useRef(false);
  const navSeq = React.useRef(0);
  // Ask for exactly the device pixels the picture will cover. A display scaled to 125% used to get
  // a 100% picture that the browser then stretched, which is what made text soft.
  const dpr = Math.round(Math.min(3, Math.max(0.4, (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * zoom)) * 100) / 100;
  const dprRef = React.useRef(dpr);
  dprRef.current = dpr;

  type Act = { op: "open" | "goto" | "reload" | "back" | "forward" | "click" | "scroll" | "type" | "key" | "shot"; url?: string; x?: number; y?: number; dy?: number; text?: string; key?: string; have?: string; /** Which wheel movement a scroll answers (never sent). */ seq?: number };
  const frameNow = React.useRef<Frame | null>(null);
  /** When the agent last did something in this browser (by this clock). */
  const agentAt = React.useRef(0);

  /** One action, in order. `quiet` actions (background refreshes) show no progress and no errors. */
  const run = React.useCallback(
    (make: () => Act | null, opts: { quiet?: boolean; nav?: boolean } = {}) => {
      const job = async () => {
        if (!alive.current || viewRef.current.w < 320) return;
        const a = make();
        if (!a) return;
        if (!opts.quiet) setBusy(true);
        try {
          const { seq: sentSeq, ...act } = a;
          const body = { ...act, w: viewRef.current.w, h: viewRef.current.h, dpr: dprRef.current, map: selectRef.current, have: frameNow.current ? hashRef.current : undefined };
          let r = await api.browser(session, body);
          if (!r.ok && r.code === "not-installed") {
            setPhase("installing");
            await api.browserInstall(session);
            r = await api.browser(session, body);
          }
          if (!alive.current) return;
          if (!r.ok) throw new Error(r.error || "The browser did not answer.");
          setPhase("ready");
          setError(null);
          hashRef.current = r.hash;
          const { shot, map: m, same, ...p } = r;
          if (shot) {
            const src = `data:image/jpeg;base64,${shot}`;
            const img = new Image();
            img.src = src;
            await img.decode().catch(() => {});
            if (!alive.current) return;
            const isNav = !!opts.nav && !still;
            if (isNav) navSeq.current++;
            if (isNav && frameNow.current) setUnder(frameNow.current);
            frameNow.current = { src, nav: navSeq.current, top: r.over?.[0] ?? 0, bottom: r.over?.[1] ?? 0 };
            setFrame(frameNow.current);
          }
          void same;
          setPage(p);
          if (p.agent) agentAt.current = Date.now() - p.agent.ago;
          if (m) {
            setMap(m);
            setHover(-1);
          }
          // The picture now shows the page's real scroll position: drop what was only anticipated,
          // unless the wheel moved again while this was in flight.
          if (a.op !== "shot" || shot) {
            if (a.op !== "scroll" || wheelSeq.current === sentSeq) target.current = p.sy;
            setOffset(Math.round(target.current - p.sy));
          }
        } catch (e) {
          if (!alive.current || opts.quiet) return;
          const msg = e instanceof Error ? e.message : String(e);
          if (pageRef.current) toast.error("The browser could not do that", { description: msg });
          else {
            setPhase("error");
            setError(msg);
          }
        } finally {
          if (alive.current && !opts.quiet) setBusy(false);
        }
      };
      chain.current = chain.current.then(job, job);
      return chain.current;
    },
    [session, still]
  );

  // Open: whatever page this sandbox's browser was last on (it outlives the pane), or a blank one.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || view.w < 320 || stage.h === 0) return;
    opened.current = true;
    wentTo.current = goTo?.n ?? 0;
    void run(() => ({ op: "open", url: goTo?.url }), { nav: true });
  }, [run, view.w, stage.h, goTo]);

  // The stage changed size (pane dragged, device switched): lay the page out again, once it settles.
  const sized = React.useRef("");
  React.useEffect(() => {
    const key = `${view.w}x${view.h}@${dpr}`;
    if (!opened.current || phase !== "ready") {
      sized.current = key;
      return;
    }
    if (sized.current === key) return;
    const t = window.setTimeout(() => {
      sized.current = key;
      void run(() => ({ op: "shot" }), { quiet: true });
    }, 220);
    return () => window.clearTimeout(t);
  }, [view.w, view.h, dpr, phase, run]);

  // While the agent works, the page it is building changes under you: look again every few seconds.
  React.useEffect(() => {
    if (!live || phase !== "ready" || page?.blank) return;
    // Every 4 s while it works; every 1.3 s while it is the one driving this page, so its clicks
    // and typing are seen as they happen.
    let tick = 0;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible" || editing) return;
      const driving = Date.now() - agentAt.current < 20_000;
      if (!driving && ++tick % 3 !== 0) return;
      void run(() => ({ op: "shot" }), { quiet: true });
    }, 1300);
    return () => window.clearInterval(t);
  }, [live, phase, page?.blank, editing, run]);

  // A click, a key or a new page can set off work that lands after the first picture: look again.
  // Most late work lands within half a second, a fetch-then-render within a few. A look that finds
  // the same picture is answered without one, so these are cheap.
  const lateLook = React.useRef<number[]>([]);
  const lookAgain = React.useCallback(() => {
    lateLook.current.forEach((t) => window.clearTimeout(t));
    lateLook.current = [450, 1600, 4000].map((ms) => window.setTimeout(() => void run(() => ({ op: "shot" }), { quiet: true }), ms));
  }, [run]);
  React.useEffect(() => () => lateLook.current.forEach((t) => window.clearTimeout(t)), []);

  const shown = page?.netError && page.tried ? page.tried : page?.blank ? "" : (page?.url ?? "");
  React.useEffect(() => {
    if (!editing) setAddress(shown);
  }, [shown, editing]);

  const go = (url: string) => {
    const u = url.trim();
    if (!u) return;
    setPins([]);
    target.current = 0;
    void run(() => ({ op: "goto", url: u }), { nav: true }).then(lookAgain);
    stageRef.current?.focus({ preventScroll: true });
  };

  // A localhost link clicked in the conversation while the pane is already open.
  const wentTo = React.useRef(0);
  React.useEffect(() => {
    if (!goTo || !opened.current || wentTo.current === goTo.n) return;
    wentTo.current = goTo.n;
    setPins([]);
    target.current = 0;
    void run(() => ({ op: "goto", url: goTo.url }), { nav: true });
  }, [goTo, run]);

  // The message went: its numbered marks have done their job, and the next pick starts at 1.
  React.useEffect(() => {
    if (!sent) return;
    setPins([]);
    setSelect(false);
    setHover(-1);
  }, [sent]);

  // The agent just finished a turn: load the page again so what it changed is what is shown. A dev
  // server with hot reload already did; a plain file server did not. Only for the sandbox's own pages.
  const wasLive = React.useRef(live);
  React.useEffect(() => {
    const ended = wasLive.current && !live;
    wasLive.current = live;
    const url = pageRef.current?.url ?? "";
    if (!ended || phase !== "ready" || !sandboxAddress(url.replace(/[?#].*$/, ""))) return;
    setPins([]);
    void run(() => ({ op: "reload", map: selectRef.current }), { quiet: true });
  }, [live, phase, run]);

  // ── select mode: the page's element boxes, hit-tested here ──
  const toggleSelect = React.useCallback(() => {
    setSelect((on) => {
      const next = !on;
      selectRef.current = next;
      setHover(-1);
      if (next) void run(() => ({ op: "shot" }), { quiet: true });
      else setMap([]);
      return next;
    });
  }, [run]);

  const local = (e: { clientX: number; clientY: number }) => {
    const b = imgBox.current?.getBoundingClientRect();
    const z = zoomRef.current;
    return b ? { x: Math.round((e.clientX - b.left) / z), y: Math.round((e.clientY - b.top) / z) } : { x: 0, y: 0 };
  };
  const imgBox = React.useRef<HTMLDivElement>(null);

  const tag = async (i: number) => {
    const el = map[i];
    const p = pageRef.current;
    if (!el || !p || !frame) return;
    const n = pins.length + 1;
    setPins((prev) => [...prev, { n, url: p.url, x: el[0] + p.sx, y: el[1] + p.sy, w: el[2], h: el[3] }]);
    // A small element alone is a few pixels of nothing: cut it out with its surroundings and mark it.
    // The sandbox draws the cut again at twice life size; the pane's own picture is the fallback.
    const cw = Math.min(view.w, Math.max(el[2] + 24, 280)), ch = Math.min(view.h, Math.max(el[3] + 24, 160));
    const box: Box = [Math.round(Math.max(0, Math.min(view.w - cw, el[0] - (cw - el[2]) / 2))), Math.round(Math.max(0, Math.min(view.h - ch, el[1] - (ch - el[3]) / 2))), cw, ch];
    const mark: Box = [el[0], el[1], el[2], el[3]];
    let detail = null;
    let image: string | null = null;
    try {
      const r = await api.browser(session, { op: "pick", i, box, w: viewRef.current.w, h: viewRef.current.h, dpr });
      detail = r.pick ?? null;
      if (r.crop) image = await markCrop(r.crop, r.cropScale ?? 1, box, mark).catch(() => null);
    } catch {
      /* the reference still carries the selector and text */
    }
    image ??= await cropFrame(frame, box, p.dpr ?? dpr, "image/png", mark).catch(() => null);
    const note = elementNote(n, p.url, el, detail);
    // No picture (the crop failed): the words alone still say which element.
    onTag(image ? { image: { name: `element-${n}-${el[4]}.png`, dataUrl: image, label: `Element ${n}`, note } } : { text: note });
  };

  const tagArea = async (box: Box) => {
    const p = pageRef.current;
    if (!p || !frame) return;
    const n = pins.length + 1;
    setPins((prev) => [...prev, { n, url: p.url, x: box[0] + p.sx, y: box[1] + p.sy, w: box[2], h: box[3] }]);
    const image = (await sharp(box)) ?? (await cropFrame(frame, box, p.dpr ?? dpr, "image/png").catch(() => null));
    const note = areaNote(n, p.url, box, map);
    onTag(image ? { image: { name: `area-${n}.png`, dataUrl: image, label: `Area ${n}`, note } } : { text: note });
  };

  /** A box of the page drawn sharp by the sandbox, or null when it could not be. */
  const sharp = async (box: Box, type: "image/png" | "image/jpeg" = "image/png"): Promise<string | null> => {
    try {
      const r = await api.browser(session, { op: "crop", box: box.map(Math.round), w: viewRef.current.w, h: viewRef.current.h, dpr });
      if (!r.crop) return null;
      return type === "image/png" ? `data:image/png;base64,${r.crop}` : await markCrop(r.crop, 1, box, undefined, type);
    } catch {
      return null;
    }
  };

  // What went wrong on this page, into the message: the fastest way to say "fix this".
  const sendErrors = async () => {
    const p = pageRef.current;
    if (!p) return;
    try {
      const logs = (await api.browser(session, { op: "logs", w: viewRef.current.w, h: viewRef.current.h, dpr })).logs ?? [];
      if (logs.length) onTag({ text: errorsNote(p.url, logs) });
    } catch {
      toast.error("Could not read the page's errors.");
    }
  };

  const snapshot = async () => {
    const p = pageRef.current;
    if (!frame || !p) return;
    // A page shown smaller than life is asked for again at full size: the agent reads small text.
    const image = ((p.dpr ?? dpr) < 1 && offset === 0 ? await sharp([0, 0, p.vw, p.vh], "image/jpeg") : null) ?? (await cropFrame(frame, [0, 0, p.vw, p.vh], p.dpr ?? dpr, "image/jpeg").catch(() => null));
    if (image) onTag({ image: { name: "page.jpg", dataUrl: image, label: "Page", note: `Screenshot of ${p.url} in the browser, ${p.vw} x ${p.vh} px, scrolled to ${p.sy}.` } });
  };

  // ── pointer, wheel, keys ──
  const scrollBy = React.useCallback(
    (dy: number, at: { x: number; y: number }) => {
      const p = pageRef.current;
      if (!p || p.blank) return;
      const max = Math.max(0, p.dh - p.vh);
      target.current = Math.min(max, Math.max(0, target.current + dy));
      wheelSeq.current++;
      setOffset(Math.round(target.current - p.sy));
      setHover(-1);
      if (scrollQueued.current) return;
      scrollQueued.current = true;
      window.setTimeout(() => {
        void run(() => {
          scrollQueued.current = false;
          const cur = pageRef.current;
          const d = Math.round(target.current - (cur?.sy ?? 0));
          if (!d) return null;
          return { op: "scroll", x: at.x, y: at.y, dy: d, seq: wheelSeq.current };
        }, { quiet: true });
      }, 60);
    },
    [run]
  );
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!pageRef.current || pageRef.current.blank) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? viewRef.current.h : 1;
      scrollBy((e.deltaY * unit) / zoomRef.current, local(e));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollBy]);

  const drag = React.useRef<{ id: number; y: number; moved: boolean; x0: number; y0: number } | null>(null);
  /** In select mode a drag marks an area instead of one element. */
  const [area, setArea] = React.useState<[number, number, number, number] | null>(null);
  const areaRef = React.useRef(area);
  areaRef.current = area;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !page || page.blank) return;
    const at = local(e);
    drag.current = { id: e.pointerId, y: e.clientY, moved: false, x0: at.x, y0: at.y };
    if (select && e.pointerType === "mouse") e.currentTarget.setPointerCapture(e.pointerId);
    stageRef.current?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && e.pointerType !== "mouse" && d.id === e.pointerId) {
      const dy = d.y - e.clientY;
      if (d.moved || Math.abs(dy) > 8) {
        d.moved = true;
        d.y = e.clientY;
        scrollBy(dy / zoomRef.current, local(e));
      }
      return;
    }
    if (select && e.pointerType === "mouse" && offset === 0) {
      const at = local(e);
      if (d && d.id === e.pointerId && (areaRef.current || Math.abs(at.x - d.x0) > 6 || Math.abs(at.y - d.y0) > 6)) {
        const x1 = Math.min(view.w, Math.max(0, at.x)), y1 = Math.min(view.h, Math.max(0, at.y));
        setArea([Math.min(d.x0, x1), Math.min(d.y0, y1), Math.abs(x1 - d.x0), Math.abs(y1 - d.y0)]);
        setHover(-1);
        return;
      }
      setHover(hitTest(map, at.x, at.y));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const marked = areaRef.current;
    if (marked) {
      setArea(null);
      if (marked[2] >= 12 && marked[3] >= 12) void tagArea(marked);
      return;
    }
    if (!d || d.moved || d.id !== e.pointerId || !page || page.blank) return;
    const at = local(e);
    if (at.x < 0 || at.y < 0 || at.x > view.w || at.y > view.h) return;
    if (select) {
      const i = hitTest(map, at.x, at.y);
      if (i >= 0) void tag(i);
      return;
    }
    if (!still) setRipple({ ...at, n: Date.now() });
    void run(() => ({ op: "click", ...at }), { nav: true });
    lookAgain();
  };

  const typed = React.useRef("");
  const typeTimer = React.useRef(0);
  const flushTyped = React.useCallback(() => {
    window.clearTimeout(typeTimer.current);
    const text = typed.current;
    typed.current = "";
    if (text) void run(() => ({ op: "type", text }), { quiet: true });
  }, [run]);
  // Picking puts the caret in the message, so Esc has to end selecting from there too.
  React.useEffect(() => {
    if (!select) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as Element | null)?.closest?.('[role="dialog"],[role="menu"],[role="listbox"]') || document.querySelector('[role="dialog"][data-state="open"],[role="menu"][data-state="open"]')) return;
      toggleSelect();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [select, toggleSelect]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!page || page.blank || select || e.ctrlKey || e.metaKey || e.altKey) return;
    if (PAGE_KEYS.has(e.key) && e.key !== "Escape") {
      e.preventDefault();
      flushTyped();
      const key = e.key;
      void run(() => ({ op: "key", key }), { quiet: key !== "Enter", nav: key === "Enter" });
      lookAgain();
    } else if (e.key.length === 1) {
      e.preventDefault();
      typed.current += e.key;
      window.clearTimeout(typeTimer.current);
      typeTimer.current = window.setTimeout(flushTyped, 220);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!text || !page || page.blank || select) return;
    e.preventDefault();
    typed.current += text;
    flushTyped();
  };

  const hovered = hover >= 0 ? map[hover] : null;
  const pagePins = page ? pins.filter((p) => p.url === page.url) : [];
  const iconBtn = "text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35";

  return (
    <motion.aside
      ref={paneRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: full || phone ? "100%" : width || "58%", opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ width: resizing ? { duration: 0 } : { duration: still ? 0 : 0.28, ease: EASE }, opacity: { duration: 0.18 } }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col overflow-hidden md:relative md:inset-auto md:h-full md:shrink-0 md:border-l"
      aria-label="Browser"
    >
      {!full && !phone && <PaneDivider value={width} range={range} onChange={setPaneWidth} onReset={() => setPaneWidth(null)} onDragging={setResizing} />}

      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-1.5 [&_.lucide]:[stroke-width:1.5]">
        <button type="button" className={iconBtn} aria-label="Back" title="Back" disabled={!page?.canBack} onClick={() => void run(() => ({ op: "back" }), { nav: true })}>
          <ArrowLeft className="size-4" />
        </button>
        <button type="button" className={cn(iconBtn, "max-sm:hidden")} aria-label="Forward" title="Forward" disabled={!page?.canForward} onClick={() => void run(() => ({ op: "forward" }), { nav: true })}>
          <ArrowRight className="size-4" />
        </button>
        <button type="button" className={iconBtn} aria-label="Reload" title="Reload" disabled={!page || page.blank} onClick={() => void run(() => ({ op: "reload" }), { nav: true })}>
          <RotateCw className={cn("size-4", busy && !still && "browser-spin")} />
        </button>
        <form
          className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent bg-[var(--muted)] px-2 transition-colors focus-within:border-[var(--line-strong)] focus-within:bg-[var(--background)]"
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
        >
          <Globe className="text-faint size-3.5 shrink-0" aria-hidden />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setAddress(shown);
                e.currentTarget.blur();
              }
            }}
            placeholder="localhost:3000 or any address"
            aria-label="Address"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            enterKeyHint="go"
            className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
        </form>
        {!!page?.errs && !page.blank && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => void sendErrors()} aria-label={`${page.errs} ${page.errs === 1 ? "error" : "errors"} on this page. Add them to your message`} className="text-destructive hover:text-destructive h-7 gap-1 px-1.5 tabular-nums">
                <TriangleAlert />
                {page.errs}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{page.errs === 1 ? "This page logged an error" : `This page logged ${page.errs} errors`}. Click to add {page.errs === 1 ? "it" : "them"} to your message</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={toggleSelect} aria-pressed={select} aria-label="Select an element" disabled={!page || page.blank} className={cn("text-muted-foreground h-7 px-2", select && "bg-live/12 text-live hover:bg-live/16 hover:text-live")}>
              <SquareDashedMousePointer />
              <span className="max-sm:hidden">Select</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Click an element, or drag over an area, to add it to your message</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={iconBtn} aria-label="Add a screenshot to your message" disabled={!page || page.blank} onClick={() => void snapshot()}>
              <Camera className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add this view to your message</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(iconBtn, "max-md:hidden")} aria-label={`Page size: ${DEVICE_LABEL[device]}`}>
                  {device === "phone" ? <Smartphone className="size-4" /> : device === "fit" ? <StretchHorizontal className="size-4" /> : <Monitor className="size-4" />}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Page size: {DEVICE_LABEL[device]}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Show the page as</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={device} onValueChange={(v) => setDevice(v as Device)}>
              <DropdownMenuRadioItem value="desktop">
                <span className="flex flex-col">
                  <span>Desktop</span>
                  <span className="text-muted-foreground text-micro">A laptop-width layout, scaled to fit the pane</span>
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="fit">
                <span className="flex flex-col">
                  <span>Pane width</span>
                  <span className="text-muted-foreground text-micro">Laid out as wide as the pane, at full size</span>
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="phone">
                <span className="flex flex-col">
                  <span>Phone</span>
                  <span className="text-muted-foreground text-micro">390 wide</span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="bg-border mx-1 h-4 w-px max-md:hidden" aria-hidden />
        {onToggleFull && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className={cn(iconBtn, "max-md:hidden")} onClick={onToggleFull} aria-pressed={full} aria-label={full ? "Show the conversation" : "Full view"}>
                {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{full ? "Show the conversation" : "Full view"}</TooltipContent>
          </Tooltip>
        )}
        <button type="button" className={iconBtn} onClick={onClose} aria-label="Close the browser" title="Close">
          <X className="size-4" />
        </button>
      </div>

      <div
        ref={stageRef}
        tabIndex={0}
        role="application"
        aria-label={page && !page.blank ? `Page: ${page.title || page.url}. Click and type to use it.` : "Browser"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(-1)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cn("browser-stage relative min-h-0 flex-1 touch-none overflow-hidden outline-none select-none", framed ? "bg-muted grid place-items-center" : "bg-card", select && "cursor-crosshair")}
      >
        {busy && <div className="browser-progress" aria-hidden />}

        {frame && page && !page.blank && (
          <div ref={imgBox} className={cn("relative origin-top-left overflow-hidden bg-white", framed && "rounded-xl shadow-e2")} style={{ width: view.w, height: view.h, transform: zoom < 1 ? `scale(${zoom})` : undefined }}>
            {under && <img src={under.src} alt="" draggable={false} className="absolute left-0 max-w-none" style={{ top: -under.top, width: view.w, height: view.h + under.top + under.bottom }} />}
            <img
              key={frame.nav}
              src={frame.src}
              alt={page.title || page.url}
              draggable={false}
              onAnimationEnd={() => setUnder(null)}
              className={cn("absolute left-0 max-w-none", !still && frame.nav > 0 && "browser-frame-in")}
              style={{ top: -frame.top, width: view.w, height: view.h + frame.top + frame.bottom, transform: offset ? `translate3d(0, ${-offset}px, 0)` : undefined }}
            />
            {offset === 0 &&
              pagePins.map((p) => (
                <div key={p.n} className="border-live pointer-events-none absolute rounded-[3px] border-[1.5px]" style={{ left: p.x - page.sx, top: p.y - page.sy, width: p.w, height: p.h }}>
                  {/* The number sits on the corner, or just inside it when the corner is at the pane's edge. */}
                  <span
                    className="bg-live absolute grid size-5 place-items-center rounded-full text-micro font-semibold text-white tabular-nums shadow-e1"
                    style={{ left: p.x - page.sx < 12 / zoom ? 2 : -10, top: p.y - page.sy < 12 / zoom ? 2 : -10, transform: zoom < 1 ? `scale(${1 / zoom})` : undefined, transformOrigin: "top left" }}
                  >
                    {p.n}
                  </span>
                </div>
              ))}
            {select && area && <div className="border-live bg-live/10 pointer-events-none absolute rounded-[3px] border-[1.5px] border-dashed" style={{ left: area[0], top: area[1], width: area[2], height: area[3] }} />}
            {select && !area && hovered && offset === 0 && (
              <div className="border-live bg-live/10 pointer-events-none absolute rounded-[3px] border-[1.5px]" style={{ left: hovered[0], top: hovered[1], width: hovered[2], height: hovered[3] }}>
                <span
                  className={cn("bg-live absolute left-[-1.5px] max-w-[18rem] truncate rounded-[4px] px-1.5 py-0.5 font-mono text-micro leading-4 whitespace-nowrap text-white", hovered[1] > 26 / zoom ? "bottom-full mb-1" : "top-full mt-1")}
                  // The page is drawn smaller than life in the desktop view; its labels are not.
                  style={zoom < 1 ? { transform: `scale(${1 / zoom})`, transformOrigin: hovered[1] > 26 / zoom ? "bottom left" : "top left" } : undefined}
                >
                  {hovered[5]} <span className="opacity-70">{hovered[2]} × {hovered[3]}</span>
                </span>
              </div>
            )}
            {ripple && <span key={ripple.n} className="browser-ripple" style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} aria-hidden />}
          </div>
        )}

        {phase === "ready" && page?.blank && <Blank ports={page.ports ?? []} onGo={go} />}

        {(phase === "starting" || phase === "installing") && !frame && (
          <div className="absolute inset-0 grid place-items-center px-6" role="status">
            <div className="flex max-w-xs flex-col items-center gap-3 text-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" aria-hidden />
              <p className="text-foreground text-body font-medium">{phase === "installing" ? "Setting up the browser" : "Starting the browser"}</p>
              <p className="text-muted-foreground text-meta">{phase === "installing" ? "This sandbox gets its own copy the first time. It takes about ten seconds and then stays." : "It runs inside this sandbox, next to the agent."}</p>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="absolute inset-0 grid place-items-center px-6" role="alert">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <p className="text-foreground text-body font-medium">The browser did not start</p>
              <p className="text-muted-foreground text-meta">{!error || /did not start/i.test(error) ? "It needs about 220 MB of the sandbox's memory. If the agent is using most of it, try again in a moment." : error.charAt(0).toUpperCase() + error.slice(1)}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPhase("starting");
                  setError(null);
                  void run(() => ({ op: "open" }), { nav: true });
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {select && page && !page.blank && (
          <motion.div
            initial={still ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="bg-popover text-popover-foreground pointer-events-none absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-meta shadow-e2"
          >
            <span className="bg-live size-1.5 shrink-0 rounded-full" aria-hidden />
            <span className="truncate">{pagePins.length ? `${pagePins.length} added to your message. Pick more, or` : "Click an element or drag over an area."}</span>
            <Kbd className="max-sm:hidden">Esc</Kbd>
            <span className="text-muted-foreground max-sm:hidden">{pagePins.length ? "to finish" : "to stop"}</span>
          </motion.div>
        )}
        {!select && live && page && !page.blank && page.agent && page.agent.ago < 12_000 && (
          <motion.div
            key={page.agent.did}
            initial={still ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            role="status"
            className="bg-popover text-popover-foreground pointer-events-none absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-meta shadow-e2"
          >
            <span className="bg-live browser-spin size-1.5 shrink-0 rounded-full" aria-hidden />
            <span className="truncate">The agent {page.agent.did}</span>
          </motion.div>
        )}
      </div>
    </motion.aside>
  );
}

const DEVICE_LABEL: Record<Device, string> = { desktop: "Desktop", fit: "Pane width", phone: "Phone" };

/** Nothing open yet: say where this browser is, and offer what is listening there. */
function Blank({ ports, onGo }: { ports: number[]; onGo: (url: string) => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-xl">
          <Globe className="size-5" strokeWidth={1.5} aria-hidden />
        </span>
        <h3 className="text-foreground mt-4 text-h3 font-semibold text-balance">Open a page in the sandbox</h3>
        <p className="text-muted-foreground mt-1.5 text-meta text-pretty">This browser runs next to the agent, so localhost is whatever it started. Type an address above, then use Select to point at what you mean.</p>
        {ports.length > 0 && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <span className="text-faint text-micro">Listening in this sandbox</span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {ports.map((p) => (
                <button key={p} type="button" onClick={() => onGo(`localhost:${p}`)} className="text-foreground hover:bg-muted cursor-pointer rounded-md border px-2.5 py-1 font-mono text-meta transition-colors active:scale-[0.98]">
                  localhost:{p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A sharp cut from the sandbox with the picked element outlined (or re-encoded as a JPEG). */
async function markCrop(b64: string, k: number, box: Box, mark?: Box, type: "image/png" | "image/jpeg" = "image/png"): Promise<string> {
  const src = `data:image/png;base64,${b64}`;
  if (!mark && type === "image/png") return src;
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext("2d")!;
  g.drawImage(img, 0, 0);
  if (mark) {
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--live").trim() || "#2f5bea";
    g.lineWidth = Math.max(2, 1.5 * k);
    g.strokeRect((mark[0] - box[0]) * k, (mark[1] - box[1]) * k, mark[2] * k, mark[3] * k);
  }
  return canvas.toDataURL(type, 0.88);
}

/** A box of the viewport (x, y, width, height in page pixels) cut out of the current picture, as a data URL. */
async function cropFrame(frame: Frame, box: Box, scale: number, type: "image/png" | "image/jpeg", mark?: Box): Promise<string> {
  const img = new Image();
  img.src = frame.src;
  await img.decode();
  const sx = Math.max(0, Math.min(img.naturalWidth - box[2] * scale, box[0] * scale));
  const sy = Math.max(0, Math.min(img.naturalHeight - box[3] * scale, (box[1] + frame.top) * scale));
  const sw = Math.min(img.naturalWidth - sx, box[2] * scale);
  const sh = Math.min(img.naturalHeight - sy, box[3] * scale);
  if (sw < 2 || sh < 2) throw new Error("nothing to crop");
  const k = Math.min(1, 1600 / sw, 1600 / sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const g = canvas.getContext("2d")!;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (mark) {
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--live").trim() || "#2f5bea";
    g.lineWidth = Math.max(2, 1.5 * scale * k);
    g.strokeRect((mark[0] * scale - sx) * k, ((mark[1] + frame.top) * scale - sy) * k, mark[2] * scale * k, mark[3] * scale * k);
  }
  return canvas.toDataURL(type, 0.85);
}

function PaneDivider({ value, range, onChange, onReset, onDragging }: { value: number; range: Range; onChange: (w: number) => void; onReset: () => void; onDragging: (on: boolean) => void }) {
  const [active, setActive] = React.useState(false);
  const set = (w: number) => onChange(clampTo(w, range));
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const start = value;
    el.setPointerCapture(e.pointerId);
    setActive(true);
    onDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => set(start + (x0 - ev.clientX));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("lostpointercapture", end);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setActive(false);
      onDragging(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("lostpointercapture", end);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize browser"
      aria-valuenow={value}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 64 : 16;
        const next = e.key === "ArrowLeft" ? value + by : e.key === "ArrowRight" ? value - by : null;
        if (next === null) return;
        e.preventDefault();
        set(next);
      }}
      className={cn("absolute inset-y-0 left-0 z-30 w-1.5 -translate-x-1/2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-[var(--line-strong)] focus-visible:after:bg-[var(--live)]", active && "after:bg-[var(--live)]")}
    />
  );
}
