import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

/**
 * Dictation, native: Android's SpeechRecognizer via expo-speech-recognition, same contract as the
 * web hook — interim words stream out for the live pill, finalized phrases fire `onFinal`, nothing
 * auto-sends. `level` (0..1) comes from the recognizer's volume events and drives the equalizer.
 */

export type VoiceState = "idle" | "arming" | "listening" | "error";

export function useVoiceInput({ onFinal }: { onFinal: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  // The engine restarts between utterances on Android; only user intent ends the session.
  const wantListening = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    ExpoSpeechRecognitionModule.isRecognitionAvailable && setSupported(ExpoSpeechRecognitionModule.isRecognitionAvailable());
  }, []);

  useSpeechRecognitionEvent("start", () => setState("listening"));
  useSpeechRecognitionEvent("audiostart", () => setState("listening"));
  useSpeechRecognitionEvent("result", (e) => {
    const t = e.results?.[0]?.transcript ?? "";
    if (e.isFinal) {
      setInterim("");
      if (t.trim()) onFinalRef.current(t.trim());
    } else {
      setInterim(t);
    }
  });
  useSpeechRecognitionEvent("volumechange", (e) => {
    // e.value is roughly -2..10 dB-ish; fold to 0..1.
    const v = typeof e.value === "number" ? Math.max(0, Math.min(1, (e.value + 2) / 12)) : 0;
    setLevel(v);
  });
  useSpeechRecognitionEvent("error", (e) => {
    setInterim("");
    setLevel(0);
    if (e.error === "no-speech" && wantListening.current) {
      // Silence timeout — restart quietly, the user hasn't pressed stop.
      try {
        beginRecognition();
        return;
      } catch {
        /* fall through */
      }
    }
    wantListening.current = false;
    setState(e.error === "no-speech" || e.error === "aborted" ? "idle" : "error");
  });
  useSpeechRecognitionEvent("end", () => {
    setInterim("");
    setLevel(0);
    if (wantListening.current) {
      try {
        beginRecognition();
        return;
      } catch {
        /* fall through */
      }
    }
    setState("idle");
  });

  const beginRecognition = () => {
    ExpoSpeechRecognitionModule.start({
      interimResults: true,
      continuous: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  };

  const start = useCallback(async () => {
    if (wantListening.current) return;
    setState("arming");
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setState("error");
        return;
      }
      wantListening.current = true;
      beginRecognition();
    } catch {
      wantListening.current = false;
      setState("error");
    }
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    setInterim("");
    setLevel(0);
    setState("idle");
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const toggle = useCallback(() => {
    if (wantListening.current) stop();
    else void start();
  }, [start, stop]);

  // Leaving the screen releases the mic.
  useEffect(() => stop, [stop]);

  return { supported, state, interim, level, start, stop, toggle };
}

/** Space/capitalization glue so dictated text lands naturally after existing text. */
export function smartJoin(before: string, spoken: string): string {
  let t = spoken;
  const trimmed = before.trimEnd();
  const atSentenceStart = !trimmed || /[.!?\n]$/.test(trimmed);
  if (atSentenceStart && t) t = t[0].toUpperCase() + t.slice(1);
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  return (needsSpace ? " " : "") + t;
}
