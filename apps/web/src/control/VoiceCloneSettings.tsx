import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSpeechSnapshot, setSpeechPreferences, subscribeSpeech } from "@/ai/speech";
import { Choice } from "./Choice";
export function VoiceCloneSettings({ disabled }: { disabled: boolean }) {
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const cancel = () => { request.current?.abort(); };
    window.addEventListener("vivic:voice-config-change", cancel);
    return () => { cancel(); window.removeEventListener("vivic:voice-config-change", cancel); };
  }, []);
  useEffect(() => { if (disabled) request.current?.abort(); }, [disabled]);
  const speech = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot);
  const [voices, setVoices] = useState<string[]>([]), [fileId, setFileId] = useState(""), [text, setText] = useState("");
  const [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/speech/cloned-voices", { cache: "no-store", signal: controller.signal }).then(r => r.ok ? r.json() : null).then(value => {
      if (!controller.signal.aborted && Array.isArray(value?.voices)) setVoices(value.voices.filter((id: unknown) => typeof id === "string" && /^voice-[A-Za-z0-9_-]{1,100}$/.test(id)).slice(0, 20));
    }).catch(() => {});
    return () => controller.abort();
  }, [disabled]);
  const clone = async () => {
    if (disabled || busy || !authorized || !/^file-[A-Za-z0-9_-]{1,100}$/.test(fileId.trim())) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/speech/cloned-voices", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: fileId.trim(), ...(text.trim() ? { text: text.trim() } : {}), authorized: true }) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok && result.ok && typeof result.id === "string" && /^voice-[A-Za-z0-9_-]{1,100}$/.test(result.id)) {
        setVoices(previous => [...new Set([...previous, result.id])].slice(-20)); setSpeechPreferences({ clonedVoiceId: result.id });
        setMessage("音色已创建并选用；语音开关保持当前设置。原文件仍由 StepFun 管理。"); setFileId(""); setText(""); setAuthorized(false);
      } else setMessage(typeof result.error === "string" ? result.error.slice(0, 300) : "音色复刻未完成。");
    } catch { if (!controller.signal.aborted) setMessage("音色复刻服务暂不可用，请重试。"); }
    finally { setBusy(false); }
  };
  const current = speech.preferences.clonedVoiceId;
  return <div className="mt-3 border-t border-neutral-100 pt-3" data-vivic-voice-clone>
    <p className="text-xs font-medium text-neutral-700">复刻音色</p>
    <p className="mt-1 text-xs text-neutral-500">使用已上传至 StepFun 的 5–10 秒 WAV/MP3 文件。输入其 File ID 后，通过 Plan 复刻，消耗套餐额度。本页不上传文件、不录音；声音样本由 StepFun 保存，清除本地数据不会删除云端样本或音色。</p>
    <div className="mt-2"><Choice label="复刻音色选择" value={current || "official"} disabled={disabled || busy} options={[
      { value: "official", label: "使用上方官方音色" }, ...voices.map((id, index) => ({ value: id, label: `复刻音色 ${index + 1}` })),
      ...(current && !voices.includes(current) ? [{ value: current, label: "旧连接音色（需重新确认）" }] : []),
    ]} onChange={id => setSpeechPreferences({ clonedVoiceId: id === "official" ? "" : id })} /></div>
    <label className="mt-2 block text-xs text-neutral-600">已上传文件的 File ID<Input aria-label="复刻音色 File ID" maxLength={105} value={fileId} disabled={disabled || busy} onChange={event => setFileId(event.target.value)} placeholder="file-…" /></label>
    <label className="mt-2 block text-xs text-neutral-600">音频对应原文（可选）<Input aria-label="复刻音色原文" maxLength={500} value={text} disabled={disabled || busy} onChange={event => setText(event.target.value)} /></label>
    <label className="mt-2 flex items-center gap-2 text-xs text-neutral-700"><Input type="checkbox" className="h-4 w-4" checked={authorized} disabled={disabled || busy} onChange={event => setAuthorized(event.target.checked)} data-vivic-clone-authorized />我有权使用这段声音，并同意通过 Plan 复刻</label>
    <Button variant="outline" size="sm" className="mt-2" disabled={disabled || busy || !authorized || !/^file-[A-Za-z0-9_-]{1,100}$/.test(fileId.trim())} onClick={() => void clone()} data-vivic-clone-submit>{busy ? "正在复刻…" : "创建并选用音色"}</Button>
    {message && <p className="mt-2 text-xs text-neutral-600" role="status">{message}</p>}
  </div>;
}
