import * as React from "react";
import { toast } from "sonner";

/**
 * Dictation into a textbox, on-device: the Web Speech API streams interim words while you talk,
 * commits finalized phrases through `onFinal`, and never sends anything itself. A parallel
 * AudioContext analyser on the same mic gives a live amplitude (0..1) so the UI can render a real
 * equalizer instead of a canned loop.
 *
 * Two hard-won rules live here:
 *  - Chrome routinely ends a "continuous" session (silence, engine churn) WITHOUT ever marking the
 *    last utterance final. Whatever interim text is in flight at end/error/stop is committed by us,
 *    or the user's words silently vanish.
 *  - The mic is acquired (getUserMedia) BEFORE recognition starts: it settles the permission prompt
 *    first and avoids racing two capture opens on the same device.
 *
 * Unsupported browsers (Firefox) get `supported: false` and the mic button simply doesn't render.
 */

export type VoiceState = "idle" | "arming" | "listening" | "error";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function explainError(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone blocked — allow it for this site in the address bar.";
    case "network":
      return "Speech service unreachable — this browser's recognition needs a network connection.";
    case "language-not-supported":
      return "This browser's speech engine does not support your language. Chrome works best.";
    case "audio-capture":
      return "No microphone found.";
    default:
      return null;
  }
}

export function useVoiceInput({ onFinal }: { onFinal: (text: string) => void }) {
  const supported = React.useMemo(() => !!recognitionCtor(), []);
  const [state, setState] = React.useState<VoiceState>("idle");
  const [interim, setInterim] = React.useState("");
  // Mic amplitude 0..1, ~20fps.
  const [level, setLevel] = React.useState(0);
  const rec = React.useRef<SpeechRecognitionLike | null>(null);
  const media = React.useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  // While listening the engine can end on its own (silence timeout); we restart quietly unless the
  // user pressed stop.
  const wantListening = React.useRef(false);
  // The phrase still in flight — committed by us if the engine never finalizes it.
  const pending = React.useRef("");
  const onFinalRef = React.useRef(onFinal);
  onFinalRef.current = onFinal;

  const commitPending = React.useCallback(() => {
    const t = pending.current.trim();
    pending.current = "";
    setInterim("");
    if (t) onFinalRef.current(t);
  }, []);

  const teardownMeter = React.useCallback(() => {
    const m = media.current;
    if (!m) return;
    media.current = null;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
    setLevel(0);
  }, []);

  const stop = React.useCallback(() => {
    wantListening.current = false;
    const r = rec.current;
    rec.current = null;
    if (r) {
      // Detach first, then abort: WE commit the in-flight phrase exactly once, and no late final
      // result can double-insert it.
      r.onresult = null;
      r.onend = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    }
    commitPending();
    teardownMeter();
    setState("idle");
  }, [commitPending, teardownMeter]);

  const startMeter = React.useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      const tick = (t: number) => {
        if (!media.current) return;
        media.current.raf = requestAnimationFrame(tick);
        if (t - last < 50) return; // ~20fps is plenty for bars
        last = t;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 4));
      };
      media.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch {
      // Analyser is decoration; keep the stream alive so the permission stays settled.
      stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const start = React.useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current || wantListening.current) return;
    setState("arming");
    wantListening.current = true;
    // Mic first: settles the permission prompt and the device open before recognition starts.
    try {
      await startMeter();
    } catch {
      wantListening.current = false;
      setState("error");
      toast.error("Microphone blocked", { description: "Allow the microphone for this site in the address bar, then try again." });
      return;
    }
    if (!wantListening.current) {
      // User toggled off while the permission prompt was up.
      teardownMeter();
      setState("idle");
      return;
    }
    const spawn = () => {
      const r = new Ctor();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onaudiostart = () => setState("listening");
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const t = res[0]?.transcript ?? "";
          if (res.isFinal) {
            pending.current = "";
            if (t.trim()) onFinalRef.current(t.trim());
          } else {
            live += t;
          }
        }
        pending.current = live.trim();
        setInterim(live.trim());
      };
      r.onerror = (e) => {
        wantListening.current = false;
        rec.current = null;
        commitPending();
        teardownMeter();
        const benign = e.error === "no-speech" || e.error === "aborted";
        setState(benign ? "idle" : "error");
        if (!benign) {
          const msg = explainError(e.error);
          toast.error("Dictation stopped", { description: msg ?? `Speech recognition error: ${e.error}` });
        }
      };
      r.onend = () => {
        // Chrome ends sessions on silence without finalizing — rescue the in-flight phrase, then
        // come back quietly if the user never pressed stop.
        commitPending();
        if (wantListening.current) {
          try {
            spawn();
            return;
          } catch {
            /* fall through to idle */
          }
        }
        rec.current = null;
        teardownMeter();
        setState("idle");
      };
      rec.current = r;
      r.start();
    };
    try {
      spawn();
    } catch {
      wantListening.current = false;
      teardownMeter();
      setState("error");
    }
  }, [commitPending, startMeter, teardownMeter]);

  const toggle = React.useCallback(() => {
    if (wantListening.current) stop();
    else void start();
  }, [start, stop]);

  // Unmount / navigation: release the mic.
  React.useEffect(() => stop, [stop]);

  return { supported, state, interim, level, start, stop, toggle };
}

/** " " glue so dictated text lands naturally at a caret: space before when needed, capitalized at a sentence start. */
export function smartJoin(before: string, spoken: string): string {
  let t = spoken;
  const trimmed = before.trimEnd();
  const atSentenceStart = !trimmed || /[.!?\n]$/.test(trimmed);
  if (atSentenceStart && t) t = t[0].toUpperCase() + t.slice(1);
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  return (needsSpace ? " " : "") + t;
}
