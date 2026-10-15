import type { WakeKeyword } from "./types";

/** Fixed preset only. Every token was checked against the SHA-pinned 3M model vocabulary. */
export const DEFAULT_WAKE_PHRASE = "你好维维";
export const DEFAULT_WAKE_KEYWORDS: WakeKeyword[] = [{
  label: DEFAULT_WAKE_PHRASE,
  matches: [
    { tokens: ["n", "ǐ", "h", "ǎo", "w", "éi", "w", "éi"] },
    // Mandarin third-tone sandhi in 你好.
    { tokens: ["n", "í", "h", "ǎo", "w", "éi", "w", "éi"] },
  ],
  score: 1,
  threshold: 0.25,
}];
