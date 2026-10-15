/** Fixed authored phrases only. No user text is sent to an asset/model service. */
const phrases: Readonly<Record<string, { url: string }>> = {
  "我看看": { url: "/voice-feedback/checking.mp3" },
  "稍等": { url: "/voice-feedback/waiting.mp3" },
  "好的": { url: "/voice-feedback/okay.mp3" },
};
export const feedbackPhrase = (text: string) => Object.hasOwn(phrases, text) ? phrases[text]! : null;
