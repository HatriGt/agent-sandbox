import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * The three voice-mode chimes (two-tone sines, <0.4s). Players are created once on first use and
 * kept warm; every call is fire-and-forget — a device that can't play simply stays quiet. The audio
 * mode respects the ringer switch (`playsInSilentMode: false`) and mixes with whatever is playing.
 */
export type VoiceSound = "start" | "stop" | "cancel";

const SOURCES: Record<VoiceSound, number> = {
  start: require("../../assets/sounds/voice-start.wav"),
  stop: require("../../assets/sounds/voice-stop.wav"),
  cancel: require("../../assets/sounds/voice-cancel.wav"),
};

let players: Record<VoiceSound, AudioPlayer> | null = null;

function load(): Record<VoiceSound, AudioPlayer> {
  if (players) return players;
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => {});
  players = {
    start: createAudioPlayer(SOURCES.start),
    stop: createAudioPlayer(SOURCES.stop),
    cancel: createAudioPlayer(SOURCES.cancel),
  };
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
