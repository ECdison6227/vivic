import { getVoiceConfiguration } from "./voiceConfig";
import { createBrowserTtsAdapter } from "./localSpeech/browserTts";

/** Curated official subset, verified 2026-10-15. Kept in sync with API by offline tests. */
export const SPEECH_VOICES_SOURCE = "https://platform.stepfun.com/docs/zh/guides/developer/tts#官方音色清单";
export const SPEECH_VOICES = [
  { id: "cixingnansheng", name: "磁性男声" },
  { id: "wenrounansheng", name: "温柔男声" },
  { id: "ruyananshi", name: "儒雅男士" },
  { id: "jingdiannvsheng", name: "经典女声" },
  { id: "wenrounvsheng", name: "温柔女声" },
  { id: "yuanqishaonv", name: "元气少女" },
  { id: "linjiajiejie", name: "邻家姐姐" },
  { id: "zhixingjiejie", name: "知性姐姐" },
] as const;
export type SpeechVoiceId = (typeof SPEECH_VOICES)[number]["id"];

export interface SpeechPreferences {
  voice: SpeechVoiceId;
  speed: number;
  /** Browser playback volume: 0 (muted) through 1. Never sent upstream. */
  volume: number;
}

export const SPEECH_PREFERENCES_STORAGE_KEY = "vivic.speech.preferences.v1";
const DEFAULT_PREFERENCES: SpeechPreferences = { voice: "cixingnansheng", speed: 1, volume: 1 };
const isVoice = (value: unknown): value is SpeechVoiceId => SPEECH_VOICES.some((voice) => voice.id === value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const readPreferences = (): { preferences: SpeechPreferences; preferenceError: string | null } => {
  const preferences = { ...DEFAULT_PREFERENCES };
  try {
    if (typeof localStorage !== "undefined") {
      const raw: unknown = JSON.parse(localStorage.getItem(SPEECH_PREFERENCES_STORAGE_KEY) ?? "null");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if ("voice" in raw && isVoice(raw.voice)) preferences.voice = raw.voice;
        if ("speed" in raw && inRange(raw.speed, 0.5, 2)) preferences.speed = raw.speed;
        if ("volume" in raw && inRange(raw.volume, 0, 1)) preferences.volume = raw.volume;
      }
    }
    return { preferences, preferenceError: null };
  } catch {
    return { preferences, preferenceError: "无法读取语音偏好，已使用默认设置。" };
  }
};

/** Same-tab TTS status; only public preferences are persisted. */
export interface SpeechSnapshot {
  enabled: boolean;
  status: "idle" | "loading" | "playing" | "error";
  loading: boolean;
  playing: boolean;
  requestId: string | null;
  text: string | null;
  kind: "feedback" | "preview" | null;
  error: string | null;
  preferences: SpeechPreferences;
  preferenceError: string | null;
}

export type SpeechResult =
  | { status: "completed" | "skipped" | "cancelled" }
  | { status: "error"; error: string };

let snapshot: SpeechSnapshot = {
  enabled: false, status: "idle", loading: false, playing: false,
  requestId: null, text: null, kind: null, error: null, ...readPreferences(),
};
const listeners = new Set<() => void>();
// Bounded event IDs, not text: distinct commands may legitimately say the same thing.
const seen = new Set<string>();

export const getSpeechSnapshot = (): SpeechSnapshot => snapshot;
export const subscribeSpeech = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const update = (patch: Partial<SpeechSnapshot>) => {
  snapshot = { ...snapshot, ...patch };
  snapshot.loading = snapshot.status === "loading";
  snapshot.playing = snapshot.status === "playing";
  listeners.forEach((listener) => listener());
};

interface Playback {
  controller: AbortController;
  audio?: HTMLAudioElement;
  url?: string;
  done: boolean;
  finish: (result: SpeechResult) => void;
}
let active: Playback | undefined;
const browserTts = createBrowserTtsAdapter();

/** Stops both the pending HTTP request and any audio, settling its promise. */
export const cancelSpeech = (): void => {
  browserTts.cancel();
  if (active) {
    active.controller.abort();
    active.finish({ status: "cancelled" });
  } else if (snapshot.status !== "idle" || snapshot.error || snapshot.requestId !== null) {
    update({ status: "idle", error: null, requestId: null, text: null, kind: null });
  }
};

export const setSpeechEnabled = (enabled: boolean): void => {
  if (!enabled) cancelSpeech();
  if (snapshot.enabled !== enabled) update({ enabled });
};

/** Clear only Vivic's public voice preferences; never touch account storage. */
export const resetSpeechPreferences = (): void => {
  cancelSpeech();
  localStorage.removeItem(SPEECH_PREFERENCES_STORAGE_KEY);
  seen.clear();
  update({ enabled: false, preferences: { ...DEFAULT_PREFERENCES }, preferenceError: null });
};

/** Invalid values are rejected; storage denial leaves the settings usable in memory. */
export const setSpeechPreferences = (patch: Partial<SpeechPreferences>): boolean => {
  if ((patch.voice !== undefined && !isVoice(patch.voice)) ||
      (patch.speed !== undefined && !inRange(patch.speed, 0.5, 2)) ||
      (patch.volume !== undefined && !inRange(patch.volume, 0, 1))) return false;
  const preferences: SpeechPreferences = {
    voice: patch.voice ?? snapshot.preferences.voice,
    speed: patch.speed ?? snapshot.preferences.speed,
    volume: patch.volume ?? snapshot.preferences.volume,
  };
  // Changing synthesis settings cancels obsolete audio. Volume is live, with no new request.
  if (preferences.voice !== snapshot.preferences.voice || preferences.speed !== snapshot.preferences.speed) cancelSpeech();
  if (active?.audio) active.audio.volume = preferences.volume;
  let preferenceError: string | null = null;
  try {
    if (typeof localStorage === "undefined") throw new Error("storage unavailable");
    localStorage.setItem(SPEECH_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    preferenceError = "语音偏好暂未保存，刷新后可能恢复默认。";
  }
  update({ preferences, preferenceError });
  return true;
};

/**
 * Opt-in, latest-request-wins playback. Resolves on end, cancellation or error;
 * never throws for service/autoplay failures. Reusing an event ID skips playback.
 */
export const speakText = (
  text: string,
  options: { requestId: string; signal?: AbortSignal },
): Promise<SpeechResult> => playText(text, options, "feedback");

/** Explicit audition works while automatic feedback is off, without enabling it. */
export const previewSpeech = (
  options: { requestId?: string; signal?: AbortSignal } = {},
): Promise<SpeechResult> => playText("你好，我是 Vivic。这是当前音色的试听，你可以调整语速和音量。", {
  ...options, requestId: options.requestId ?? `preview-${crypto.randomUUID()}`,
}, "preview");

const playText = (
  text: string,
  options: { requestId: string; signal?: AbortSignal },
  kind: "feedback" | "preview",
): Promise<SpeechResult> => {
  if (getVoiceConfiguration().tts === "none") return Promise.resolve({ status: "skipped" });
  if (kind === "feedback" && !snapshot.enabled) return Promise.resolve({ status: "skipped" });
  if (options.signal?.aborted) return Promise.resolve({ status: "cancelled" });
  if (seen.has(options.requestId)) return Promise.resolve({ status: "skipped" });
  cancelSpeech();
  // The HTTP schema caps UTF-16 length. Never cut between a surrogate pair.
  const spokenText = typeof text === "string"
    ? text.trim().slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "").trimEnd()
    : "";
  if (!options.requestId?.trim() || options.requestId.length > 256 ||
      !spokenText ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text)) {
    const error = "语音只接受 1–200 字符的可见短句及有效请求 ID。";
    update({ status: "error", error, requestId: null, text: null, kind });
    return Promise.resolve({ status: "error", error });
  }
  seen.add(options.requestId);
  if (seen.size > 128) seen.delete(seen.values().next().value!);

  return new Promise<SpeechResult>((resolve) => {
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
      job.finish({ status: "cancelled" });
    };
    const job: Playback = {
      controller,
      done: false,
      finish: (result) => {
        if (job.done) return;
        job.done = true;
        options.signal?.removeEventListener("abort", onAbort);
        if (job.audio) {
          job.audio.onended = null;
          job.audio.onerror = null;
          job.audio.pause();
          job.audio.removeAttribute("src");
          job.audio.load();
        }
        if (job.url) URL.revokeObjectURL(job.url);
        if (active === job) {
          active = undefined;
          update(result.status === "error"
            ? { status: "error", error: result.error }
            : result.status === "cancelled"
              ? { status: "idle", error: null, requestId: null, text: null, kind: null }
              : { status: "idle", error: null });
        }
        resolve(result);
      },
    };
    active = job;
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const { voice, speed } = snapshot.preferences;
    update({ status: "loading", error: null, requestId: options.requestId, text: spokenText, kind });
    if (job.done) return;
    const run = async () => {
      try {
        const voiceConfig = getVoiceConfiguration();
        if (voiceConfig.tts === "browser") {
          browserTts.setEnabled(true);
          await browserTts.speak(spokenText, {
            ...(voiceConfig.browserVoice ? { voiceId: voiceConfig.browserVoice } : {}),
            localOnly: true, signal: controller.signal,
            rate: speed, volume: snapshot.preferences.volume,
            onStart: () => { if (!job.done) update({ status: "playing", error: null }); },
          });
          job.finish({ status: "completed" }); return;
        }
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: spokenText, voice, speed }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
          cache: "no-store",
        });
        if (job.done) return;
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const error = body && typeof body === "object" && "error" in body &&
            typeof body.error === "string" ? body.error.slice(0, 300) : `语音不可用（HTTP ${response.status}）`;
          job.finish({ status: "error", error });
          return;
        }
        const blob = await response.blob();
        if (job.done) return;
        if (!blob.size || blob.size > 4 * 1024 * 1024 || !/^audio\/(mpeg|mp3)(;|$)/i.test(blob.type)) {
          job.finish({ status: "error", error: "语音服务未返回有效音频。" });
          return;
        }
        job.url = URL.createObjectURL(blob);
        job.audio = new Audio(job.url);
        job.audio.volume = snapshot.preferences.volume;
        job.audio.onended = () => job.finish({ status: "completed" });
        job.audio.onerror = () => job.finish({ status: "error", error: "浏览器无法播放语音。" });
        await job.audio.play();
        if (!job.done) update({ status: "playing", error: null });
      } catch (error) {
        if (job.done) return;
        const blocked = error instanceof DOMException && error.name === "NotAllowedError";
        job.finish({ status: "error", error: blocked
          ? "浏览器阻止了语音播放，请在控制页交互后重试。"
          : "语音不可用：本地服务连接失败或请求超时。" });
      }
    };
    void run();
  });
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", cancelSpeech);
  window.addEventListener("vivic:voice-config-change", cancelSpeech);
}
