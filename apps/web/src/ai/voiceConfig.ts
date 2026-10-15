export type SttProvider = "stepfun" | "local" | "none";
export type TtsProvider = "stepfun" | "browser" | "none";
interface VoiceConfiguration { stt: SttProvider; tts: TtsProvider; browserVoice: string; }
const key = "vivic.voice.providers.v1";
let state: VoiceConfiguration = { stt: "stepfun", tts: "stepfun", browserVoice: "" };
try {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
  if (value && typeof value === "object") {
    if ("stt" in value && ["stepfun", "local", "none"].includes(String(value.stt))) state.stt = value.stt as SttProvider;
    if ("tts" in value && ["stepfun", "browser", "none"].includes(String(value.tts))) state.tts = value.tts as TtsProvider;
    if ("browserVoice" in value && typeof value.browserVoice === "string") state.browserVoice = value.browserVoice.slice(0, 300);
  }
} catch { /* Preferences remain available for this tab. */ }
const listeners = new Set<() => void>();
export const getVoiceConfiguration = () => state;
export const subscribeVoiceConfiguration = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const setVoiceConfiguration = (patch: Partial<VoiceConfiguration>) => {
  if ((patch.stt !== undefined && !["stepfun", "local", "none"].includes(patch.stt)) ||
    (patch.tts !== undefined && !["stepfun", "browser", "none"].includes(patch.tts))) return;
  window.dispatchEvent(new Event("vivic:voice-config-change"));
  state = { ...state, ...patch, browserVoice: (patch.browserVoice ?? state.browserVoice).slice(0, 300) };
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Nonessential preference storage. */ }
  listeners.forEach(listener => listener());
};
