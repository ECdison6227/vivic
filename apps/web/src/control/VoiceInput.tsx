import { useEffect, useRef, useSyncExternalStore } from "react";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelSpeech } from "@/ai/speech";
import { cancelVoiceInput, finishVoiceInput, getVoiceInputSnapshot, startVoiceInput, subscribeVoiceInput } from "@/ai/voiceInput";
import { getVoiceConfiguration, subscribeVoiceConfiguration } from "@/ai/voiceConfig";

interface VoiceInputProps {
  disabled: boolean;
  onBegin: () => void;
  onTranscript: (text: string) => void;
  autoExecute?: boolean;
}

/** Local press-to-talk only; no global shortcuts or automatic command execution. */
export const VoiceInput = ({ disabled, onBegin, onTranscript, autoExecute = false }: VoiceInputProps) => {
  const voice = useSyncExternalStore(subscribeVoiceInput, getVoiceInputSnapshot);
  const config = useSyncExternalStore(subscribeVoiceConfiguration, getVoiceConfiguration);
  const held = useRef(false);
  const handled = useRef<string | null>(null);
  const callback = useRef(onTranscript); callback.current = onTranscript;
  useEffect(() => {
    if (voice.status === "review" && voice.text && voice.text !== handled.current) {
      handled.current = voice.text; callback.current(voice.text);
    }
    if (voice.status === "recording") handled.current = null;
  }, [voice.status, voice.text]);
  useEffect(() => { if (disabled) { held.current = false; cancelVoiceInput(); } }, [disabled]);
  useEffect(() => () => { held.current = false; cancelVoiceInput(); }, []);

  const begin = () => {
    if (disabled || held.current) return;
    held.current = true; handled.current = null; cancelSpeech(); onBegin(); void startVoiceInput();
  };
  const finish = () => { if (held.current) { held.current = false; void finishVoiceInput(); } };
  const cancel = () => { held.current = false; cancelVoiceInput(); };
  const busy = ["requesting", "recording", "transcribing"].includes(voice.status);
  const caption = voice.status === "requesting" ? "请允许麦克风访问；授权后重新按住说话。"
    : voice.status === "recording" ? `正在录音 ${voice.seconds} / 60 秒，松开后识别。`
    : voice.status === "transcribing" ? "正在识别语音…"
    : voice.status === "review" ? "已转写，请检查输入框中的文字后点发送。"
    : voice.error ?? (autoExecute ? "按住说话，松开识别后自动发送；也可按住空格。" : "按住说话，松开后识别；检查文字后发送。也可聚焦按钮后按住空格。");

  return (
    <div className="mt-3" data-vivic-voice-input data-vivic-voice-status={voice.status}>
      <div className="flex items-center gap-2">
        <Button type="button" variant={voice.status === "recording" ? "default" : "outline"}
          disabled={disabled || config.stt === "none" || voice.status === "transcribing"}
          aria-label="按住说话" aria-pressed={voice.status === "recording"}
          className="touch-none select-none"
          data-vivic-ptt
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); begin(); }}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={() => { if (held.current) cancel(); }}
          onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); begin(); } if (event.key === "Escape") cancel(); }}
          onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); finish(); } }}
          onBlur={() => { if (held.current) cancel(); }}
        >
          {voice.status === "requesting" || voice.status === "transcribing" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : voice.status === "recording" ? <Square className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
          {voice.status === "recording" ? "松开结束" : voice.status === "requesting" ? "等待麦克风…" : voice.status === "transcribing" ? "识别中…" : "按住说话"}
        </Button>
        {busy && <Button type="button" variant="ghost" onClick={cancel} data-vivic-voice-cancel><X className="mr-1 h-4 w-4" />取消录音</Button>}
      </div>
      <p className={`mt-2 text-xs ${voice.error ? "text-red-700" : "text-neutral-500"}`} role="status" aria-live="polite" data-vivic-voice-note>{caption}</p>
    </div>
  );
};
