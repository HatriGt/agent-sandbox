import * as React from "react";

/**
 * Dictation into a textbox, on-device: the Web Speech API streams interim words while you talk,
 * commits finalized phrases through `onFinal`, and never sends anything itself. A parallel
 * AudioContext analyser on the same mic gives a live amplitude (0..1) so the UI can render a real
 * equalizer instead of a canned loop.
 *
 * Unsupported browsers (Firefox) get `supported: false` and the mic button simply doesn't render.
 */

export type VoiceState = "idle" | "arming" | "listening" | "error";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
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

export function useVoiceInput({ onFinal }: { onFinal: (text: string) => void }) {
  const supported = React.useMemo(() => !!recognitionCtor(), []);
  const [state, setState] = React.useState<VoiceState>("idle");
  const [interim, setInterim] = React.useState("");
  // Mic amplitude 0..1, ~20fps — read via ref by the equalizer to avoid re-rendering the composer.
  const [level, setLevel] = React.useState(0);
  const rec = React.useRef<SpeechRecognitionLike | null>(null);
  const media = React.useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  // While listening the engine can end on its own (silence timeout); we restart quietly unless the
  // user pressed stop.
  const wantListening = React.useRef(false);
  const onFinalRef = React.useRef(onFinal);
  onFinalRef.current = onFinal;

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
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
    rec.current = null;
    teardownMeter();
    setInterim("");
    setState("idle");
  }, [teardownMeter]);

  const startMeter = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      // Meter is decoration — recognition still works without it (it opens its own mic).
    }
  }, []);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    setState("arming");
    wantListening.current = true;
    const spawn = () => {
      const r = new Ctor();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.onaudiostart = () => setState("listening");
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const t = res[0]?.transcript ?? "";
          if (res.isFinal) {
            if (t.trim()) onFinalRef.current(t.trim());
          } else {
            live += t;
          }
        }
        setInterim(live.trim());
      };
      r.onerror = (e) => {
        wantListening.current = false;
        rec.current = null;
        teardownMeter();
        setInterim("");
        setState(e.error === "no-speech" || e.error === "aborted" ? "idle" : "error");
      };
      r.onend = () => {
        setInterim("");
        // Chrome ends recognition after a stretch of silence; if the user never pressed stop, come back.
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
      void startMeter();
    } catch {
      setState("error");
      wantListening.current = false;
    }
  }, [startMeter, teardownMeter]);

  const toggle = React.useCallback(() => {
    if (wantListening.current) stop();
    else start();
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
