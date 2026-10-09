import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * The voice-mode chimes (soft sines with a touch of second harmonic, all <0.4s). Players are created
 * once on first use and kept warm; every call is fire-and-forget — a device that can't play simply
 * stays quiet. The audio mode respects the ringer switch (`playsInSilentMode: false`) and mixes with
 * whatever is playing.
 */
export type VoiceSound = "open" | "done" | "cancel" | "pause" | "resume" | "phrase";

const SOURCES: Record<VoiceSound, number> = {
  open: require("../../assets/sounds/voice-open.wav"),
  done: require("../../assets/sounds/voice-done.wav"),
  cancel: require("../../assets/sounds/voice-cancel.wav"),
  pause: require("../../assets/sounds/voice-pause.wav"),
  resume: require("../../assets/sounds/voice-resume.wav"),
  phrase: require("../../assets/sounds/voice-phrase.wav"),
};

let players: Record<VoiceSound, AudioPlayer> | null = null;

function load(): Record<VoiceSound, AudioPlayer> {
  if (players) return players;
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => {});
  const made = {} as Record<VoiceSound, AudioPlayer>;
  for (const k of Object.keys(SOURCES) as VoiceSound[]) made[k] = createAudioPlayer(SOURCES[k]);
  players = made;
  return players;
}

export function playVoiceSound(kind: VoiceSound): void {
  try {
    const p = load()[kind];
    p.seekTo(0)
      .then(() => p.play())
      .catch(() => {});
  } catch {
    /* no audio backend */
  }
}
