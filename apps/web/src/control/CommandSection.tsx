import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LoaderCircle, Volume2 } from "lucide-react";
import { getSpeechSnapshot, subscribeSpeech } from "@/ai/speech";
import type { ResolvedCard } from "@/commands/references";
import type { CommandClarifyAction } from "@/commands/parse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceInput } from "./VoiceInput";
import { cancelVoiceInput } from "@/ai/voiceInput";
import { ImageAttachment } from "./ImageAttachment";
import type { Attachment } from "@/ai/attachments";
import { getProvidersStatus } from "@/ai/api";
import { LocalWakeInput } from "./LocalSpeechSettings";
import { getVoiceConfiguration, subscribeVoiceConfiguration } from "@/ai/voiceConfig";

export interface ClarifyState {
  action: CommandClarifyAction;
  canvasId?: string;
  candidates: ResolvedCard[];
  prompt: string;
  choiceId?: string;
  expiresAt?: number;
}

interface CommandSectionProps {
  disabled: boolean;
  clarify: ClarifyState | null;
  feedback: string | null;
  suggestions?: string[];
  backendOnline: boolean | null;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  ownerKey?: string;
  onPickClarify: (candidate: ResolvedCard) => void;
  onPreviewClarify?: (candidate: ResolvedCard) => void;
  onCancelClarify: () => void;
  busy: boolean;
  onCancel: () => void;
}

export const CommandSection = ({
  disabled,
  clarify,
  feedback,
  suggestions = [],
  backendOnline,
  onSubmit,
  onPickClarify,
  onPreviewClarify,
  onCancelClarify,
  busy,
  onCancel,
  ownerKey = "control",
}: CommandSectionProps) => {
  const [text, setText] = useState("");
  const composing = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const latestDraft = useRef(text); latestDraft.current = text;
  const draftAtVoiceStart = useRef("");
  const [unappliedVoice, setUnappliedVoice] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(false);
  const autoAtVoiceStart = useRef(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageReset, setImageReset] = useState(0);
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [wakeCancelKey, setWakeCancelKey] = useState(0);
  const voiceConfig = useSyncExternalStore(subscribeVoiceConfiguration, getVoiceConfiguration);
  const speech = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot);
  useEffect(() => {
    let active = true;
    const clear = () => { setAttachment(null); setImageReset(value => value + 1); setWakeCancelKey(value => value + 1); };
    const refresh = async () => {
      try { const data = await getProvidersStatus(); const provider = data.providers.find(item => item.name === (data.activeProvider ?? "stepfun"));
        if (active) setVisionAvailable(Boolean(provider?.connected && provider.capabilities.includes("vision")));
      } catch { if (active) setVisionAvailable(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    window.addEventListener("vivic:provider-change", clear);
    window.addEventListener("vivic:voice-config-change", clear);
    return () => { active = false; clearInterval(timer); window.removeEventListener("vivic:provider-change", clear); window.removeEventListener("vivic:voice-config-change", clear); };
  }, []);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const began = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = () => {
    const value = text.trim();
    if (!value || imageProcessing || (attachment && !visionAvailable)) return;
    const images = attachment ? [attachment] : undefined;
    setWakeCancelKey(value => value + 1);
    setAttachment(null); setImageReset(value => value + 1);
    cancelVoiceInput(); setUnappliedVoice(null);
    setText("");
    onSubmit(value, images);
  };
  const beginVoiceDraft = () => {
    onCancel(); draftAtVoiceStart.current = latestDraft.current; autoAtVoiceStart.current = autoVoice; setUnappliedVoice(null);
  };
  const receiveTranscript = (value: string) => {
    if (!attachment && !imageProcessing && latestDraft.current === draftAtVoiceStart.current && autoAtVoiceStart.current && autoVoice) {
      cancelVoiceInput(); setText(""); onSubmit(value);
    } else if (latestDraft.current === draftAtVoiceStart.current) setText(value);
    else setUnappliedVoice(value);
  };

  const modePill =
    backendOnline === null
      ? { text: "意图路由检查中…", cls: "bg-neutral-100 text-neutral-500" }
      : backendOnline
        ? { text: "决策服务 · 规则优先", cls: "bg-emerald-100 text-emerald-800" }
        : { text: "离线本地模式", cls: "bg-amber-100 text-amber-800" };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex justify-end">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${modePill.cls}`}
          data-vivic-intent-mode
        >
          {modePill.text}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (composing.current) return;
          submit();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="试试：十分钟倒计时 / 加待办：买菜；回邮件 / 放大左边的待办 / 删除那个卡片"
          disabled={disabled}
          aria-label="指令输入"
          data-vivic-command-input
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (event.key === "Escape" && clarify) { event.preventDefault(); onCancelClarify(); }
          }}
        />
        <Button
          type="submit"
          disabled={disabled || !text.trim() || imageProcessing || Boolean(attachment && !visionAvailable)}
          data-vivic-command-send
        >
          {busy ? "发送新指令" : "发送"}
        </Button>
        {busy && (
          <Button type="button" variant="outline" onClick={() => { setWakeCancelKey(value => value + 1); onCancel(); }} data-vivic-command-cancel>
            取消
          </Button>
        )}
      </form>
      <ImageAttachment disabled={disabled} ownerKey={ownerKey} resetKey={imageReset} visionAvailable={visionAvailable}
        onChange={setAttachment} onProcessingChange={setImageProcessing} />

      <VoiceInput disabled={disabled || (backendOnline === false && voiceConfig.stt === "stepfun")} autoExecute={autoVoice}
        onBegin={() => { setWakeCancelKey(value => value + 1); beginVoiceDraft(); }} onTranscript={receiveTranscript} />
      <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
        <Input type="checkbox" className="h-4 w-4 shrink-0 accent-neutral-900" checked={autoVoice}
          disabled={disabled} onChange={event => setAutoVoice(event.target.checked)} data-vivic-voice-auto />
        识别后自动发送（默认关闭）
      </label>
      {voiceConfig.stt !== "none" && <LocalWakeInput ownerKey={ownerKey} cancelKey={wakeCancelKey}
        disabled={disabled || busy || (backendOnline === false && voiceConfig.stt === "stepfun")}
        speaking={speech.loading || speech.playing} recognition={voiceConfig.stt === "local" ? "local" : "segment"}
        onBegin={beginVoiceDraft} onTranscript={receiveTranscript}
        onSegment={async event => {
          const form = new FormData(); form.append("file", event.wav, "voice.wav");
          const response = await fetch("/api/transcribe", { method: "POST", body: form,
            signal: AbortSignal.any([event.signal, AbortSignal.timeout(40000)]), cache: "no-store" });
          const result = await response.json();
          if (event.signal.aborted) return;
          if (!response.ok || result.ok !== true || typeof result.text !== "string" || !result.text.trim() || result.text.length > 500) {
            throw new Error(typeof result.error === "string" ? result.error.slice(0, 300) : "语音识别未完成，请改用文字或PTT。");
          }
          receiveTranscript(result.text);
        }} />}
      {unappliedVoice && <div className="mt-2 rounded-lg bg-neutral-50 p-3 text-sm" data-vivic-unapplied-voice>
        <p>{unappliedVoice}</p>
        <p className="mt-1 text-xs text-neutral-500">你在识别期间改过输入，已保留现有文字。</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setText(unappliedVoice); setUnappliedVoice(null); }}>使用这段转写</Button>
      </div>}

      {clarify && (
        <div
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
          data-vivic-clarify
        >
          <p className="text-sm text-amber-900">{clarify.prompt}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {clarify.candidates.map((c, index) => (
              <Button
                key={c.card.id}
                variant="outline"
                size="sm"
                onClick={() => onPickClarify(c)}
                onPointerEnter={() => onPreviewClarify?.(c)}
                onFocus={() => onPreviewClarify?.(c)}
                data-vivic-clarify-candidate
              >
                {index + 1}号 · {c.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={onCancelClarify}>
              取消
            </Button>
          </div>
        </div>
      )}

      {(busy || speech.status === "loading" || speech.status === "playing") && <div
        className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900"
        data-vivic-command-progress
      >
        {speech.status === "playing" && !busy ? <Volume2 className="h-4 w-4" /> : <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        <span>{busy ? "正在理解并安排你的指令" : speech.status === "loading" ? "正在准备语音" : "正在说话"}</span>
        {busy && <span className="ml-auto text-xs text-violet-600" data-vivic-wait-seconds>{elapsed} 秒</span>}
      </div>}
      <p
        className="mt-3 min-h-4 text-xs text-neutral-500"
        aria-live="polite"
        role="status"
        aria-busy={busy}
        data-vivic-command-feedback
      >
        {feedback ?? "输入指令即可操作画布；复杂指令由已连接的模型理解。"}
      </p>
      {suggestions.length > 0 && <div className="mt-2 flex flex-wrap gap-2" data-vivic-data-suggestions>
        {suggestions.map(suggestion => <Button key={suggestion} type="button" variant="outline" size="sm"
          disabled={disabled || busy} onClick={() => { setText(""); onSubmit(suggestion); }}>{suggestion}</Button>)}
      </div>}
    </section>
  );
};
