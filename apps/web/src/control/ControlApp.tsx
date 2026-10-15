import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buildCanvasContext, postIntent } from "@/ai/api";
import { cancelSpeech, speakText, subscribeSpeech, getSpeechSnapshot } from "@/ai/speech";
import { clarifiedCardAction, parseCommand, type CommandResult } from "@/commands/parse";
import type { ResolvedCard } from "@/commands/references";
import { applyUrlTheme } from "@/lib/urlTheme";
import { newId } from "@/lib/id";
import { canvasStore } from "@/state/canvasStore";
import { getControlHost } from "@/sync/browserRuntime";
import type { ControlHost } from "@/sync/controlHost";
import { AiSection } from "./AiSection";
import { CanvasManager } from "./CanvasManager";
import { CommandSection, type ClarifyState } from "./CommandSection";
import { DataActions } from "./DataActions";
import { RemindersSection } from "./RemindersSection";
import type { ReminderNotice } from "@/reminders/reminders";
import { cancelVoiceInput, getVoiceInputSnapshot, isVoiceInputBusy, subscribeVoiceInput } from "@/ai/voiceInput";
import { LocalSpeechSettings } from "./LocalSpeechSettings";
import { CanvasSettings } from "./CanvasSettings";
import type { Attachment } from "@/ai/attachments";

export const INTENT_TIMEOUT_MS = 100_000;

declare global {
  interface Window {
    __vivicControl?: {
      snapshot: () => unknown;
      switchCanvas: (id: string) => void;
      createCanvas: (title?: string) => string;
      undo: () => boolean;
      takeover: () => void;
    };
  }
}

export const ControlApp = () => {
  const [host, setHost] = useState<ControlHost | null>(null);
  const [clarify, setClarify] = useState<ClarifyState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{
    requestId: string;
    canvasId: string;
    controller: AbortController;
    slowTimer: ReturnType<typeof setTimeout>;
    deadlineTimer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const reminderQueue = useRef<ReminderNotice[]>([]);
  const announcing = useRef(false);
  const previousQuestion = useRef<{ canvasId: string; utterance: string; question: string; at: number } | null>(null);

  const cancelPending = useCallback(() => {
    cancelVoiceInput();
    cancelSpeech();
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    current.controller.abort();
    clearTimeout(current.slowTimer);
    clearTimeout(current.deadlineTimer);
    host?.setActivity(current.requestId, null);
    setBusy(false);
    setFeedback("已取消本次请求");
  }, [host]);

  useEffect(() => {
    window.addEventListener("vivic:provider-change", cancelPending);
    window.addEventListener("vivic:voice-config-change", cancelPending);
    return () => { window.removeEventListener("vivic:provider-change", cancelPending); window.removeEventListener("vivic:voice-config-change", cancelPending); };
  }, [cancelPending]);

  // Speech state follows actual audio loading/playback, rather than a guessed
  // fixed subtitle duration. The short lease also expires if control disappears.
  useEffect(() => {
    if (!host) return;
    let voiceActivityId: string | null = null;
    const update = () => {
      const speech = getSpeechSnapshot() as ReturnType<typeof getSpeechSnapshot> & { requestId?: string; text?: string };
      if (pending.current || isVoiceInputBusy() || host.getSnapshot().ownerMode !== "owner") return;
      const live = speech.status === "loading" || speech.status === "playing";
      if (live && speech.requestId) {
        const requestId = `voice_${speech.requestId}`.slice(0, 128);
        voiceActivityId = requestId;
        host.setActivity(requestId, { requestId,
          text: speech.status === "loading" ? "正在准备语音…" : (speech.text ?? "").slice(0, 120) || "正在说话…",
          phase: speech.status === "loading" ? "preparing-speech" : "speaking",
          expiresAt: Date.now() + 6000,
        });
      } else if (voiceActivityId) {
        host.setActivity(voiceActivityId, null);
        voiceActivityId = null;
      }
    };
    const unsubscribe = subscribeSpeech(update);
    const timer = setInterval(update, 2000);
    return () => { unsubscribe(); clearInterval(timer); if (voiceActivityId) host.setActivity(voiceActivityId, null); };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    let requestId: string | null = null;
    const update = () => {
      const voice = getVoiceInputSnapshot();
      if (host.getSnapshot().ownerMode !== "owner") return;
      if (isVoiceInputBusy()) {
        requestId ??= newId("microphone");
        host.setActivity(requestId, { requestId,
          phase: voice.status === "transcribing" ? "transcribing" : "listening",
          text: voice.status === "transcribing" ? "正在识别语音…" : voice.status === "requesting" ? "等待麦克风授权…" : "在听，请说…",
          expiresAt: Date.now() + 6000,
        });
      } else if (requestId) { host.setActivity(requestId, null); requestId = null; }
    };
    const unsubscribe = subscribeVoiceInput(update);
    const timer = setInterval(update, 2000);
    return () => { unsubscribe(); clearInterval(timer); if (requestId) host.setActivity(requestId, null); };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    const seen = new Set(host.getSnapshot().reminderNotices.map(n => n.id));
    let cancelled = false;
    const drain = async () => {
      if (announcing.current || pending.current || isVoiceInputBusy() || getSpeechSnapshot().status === "playing" || getSpeechSnapshot().status === "loading") return;
      announcing.current = true;
      try {
        while (!cancelled && reminderQueue.current.length && !pending.current && !isVoiceInputBusy() && host.getSnapshot().ownerMode === "owner" &&
          getSpeechSnapshot().status !== "playing" && getSpeechSnapshot().status !== "loading") {
          const notice = reminderQueue.current.shift()!;
          // If the timer was removed/rescheduled after firing, don't read a
          // now-obsolete queued announcement when another sound finishes.
          const current = host.getSnapshot().reminders.find(r => r.canvasId === notice.canvasId && r.card.id === notice.cardId);
          if (!current || current.card.sourceData.targetAt !== notice.targetAt || !current.card.sourceData.notifiedAt || current.card.sourceData.pausedAt) continue;
          await speakText(`提醒：${notice.text}`.slice(0, 200), { requestId: notice.id });
        }
      } finally { announcing.current = false; }
    };
    const collect = () => {
      for (const notice of host.getSnapshot().reminderNotices) {
        if (seen.has(notice.id)) continue;
        const timer = host.getSnapshot().reminders.find(r => r.canvasId === notice.canvasId && r.card.id === notice.cardId);
        if (!timer?.card.sourceData.notifiedAt || timer.card.sourceData.pausedAt || timer.card.sourceData.targetAt !== notice.targetAt) continue;
        seen.add(notice.id);
        reminderQueue.current.push(notice);
      }
      if (host.getSnapshot().ownerMode !== "owner") reminderQueue.current = [];
      void drain();
    };
    const unsubscribe = host.subscribe(collect);
    const timer = setInterval(() => void drain(), 500);
    return () => { cancelled = true; unsubscribe(); clearInterval(timer); reminderQueue.current = []; };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    let lastCanvasId = host.getSnapshot().activeCanvasId;
    const unsubscribe = host.subscribe(() => {
      const current = pending.current;
      const snap = host.getSnapshot();
      if (snap.activeCanvasId !== lastCanvasId || snap.ownerMode !== "owner") { cancelSpeech(); cancelVoiceInput(); setClarify(null); }
      lastCanvasId = snap.activeCanvasId;
      if (current && (snap.activeCanvasId !== current.canvasId || snap.ownerMode !== "owner")) {
        cancelPending();
      }
    });
    return () => {
      unsubscribe();
      cancelPending();
    };
  }, [host, cancelPending]);

  useEffect(() => {
    let cancelled = false;
    applyUrlTheme();
    void getControlHost().then((h) => {
      if (cancelled) return;
      setHost(h);
      if (import.meta.env.DEV) {
        window.__vivic = {
          dispatch: (raw) => h.dispatch(raw),
          internal: (action) =>
            canvasStore.internal(
              action as Parameters<typeof canvasStore.internal>[0],
            ),
          getState: () => canvasStore.getState(),
        };
        window.__vivicControl = {
          snapshot: () => h.getSnapshot(),
          switchCanvas: (id) => h.switchCanvas(id),
          createCanvas: (title) => h.createCanvas(title),
          undo: () => h.undo(),
          takeover: () => h.takeover(),
        };
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyResult = useCallback(
    (h: ControlHost, result: CommandResult) => {
      const { activeCanvasId } = h.getSnapshot();
      if (result.kind === "unknown") {
        setFeedback(result.message);
        return;
      }
      if (result.kind === "undo") {
        const text = h.undo() ? "已撤销上一次删除" : "没有可撤销的删除";
        setFeedback(text);
        void speakText(text, { requestId: newId("speech") });
        return;
      }
      if (result.kind === "clarify") {
        setClarify({ ...result, canvasId: activeCanvasId ?? undefined });
        // Highlight candidates on stage; nothing destructive happens yet.
        const dispatched = h.dispatch({
          schemaVersion: "0.6",
          requestId: newId("cmd"),
          canvasId: activeCanvasId ?? "",
          spokenText: result.prompt,
          actions: result.candidates.map((c) => ({
            type: "card.highlight" as const,
            targetId: c.card.id,
            durationMs: 4000,
          })),
        });
        if (dispatched.ok) void speakText(result.prompt, { requestId: newId("speech") });
        return;
      }
      const res = h.dispatch({
        schemaVersion: "0.6",
        requestId: newId("cmd"),
        canvasId: activeCanvasId ?? "",
        spokenText: result.spokenText,
        actions: result.actions,
      });
      setFeedback(
        res.ok ? result.description : `指令未执行（${res.ok ? "" : res.error}）`,
      );
      if (res.ok && result.spokenText) void speakText(result.spokenText, { requestId: newId("speech") });
    },
    [],
  );

  const submitCommand = useCallback(
    (text: string, attachments?: Attachment[]) => {
      if (!host) return;
      const snap = host.getSnapshot();
      if (!snap.activeCanvasId || snap.ownerMode !== "owner") return;
      cancelPending();
      setClarify(null);
      const activeCanvasId = snap.activeCanvasId;
      const trimmed = text.trim();
      const previous = previousQuestion.current;
      const continuation = previous && previous.canvasId === activeCanvasId && Date.now() - previous.at < 120_000 && trimmed.length <= 80
        && !attachments?.length && !/^(?:搜索|搜|查|创建|新建|添加|删除|取消|打开|显示|恢复|撤销)/.test(trimmed)
        ? { utterance: previous.utterance, question: previous.question } : undefined;
      previousQuestion.current = null;
      if (!attachments?.length && /^(?:重新排布|整理布局|整理画布|排好卡片)$/.test(trimmed)) {
        const result = host.arrangeCanvas();
        setFeedback(result.ok ? "已重新排布，固定卡片保持原位。" : "暂时无法整理布局，请检查控制权后重试。");
        return;
      }
      const runLocal = () =>
        applyResult(
          host,
          parseCommand(trimmed, {
            state: canvasStore.getState(),
            canvasId: activeCanvasId,
          }),
        );
      // 撤销 is window-local undo-stack semantics: handle it here, never
      // round-trip to the decision API.
      if (!attachments?.length && /^(撤销|撤销删除)$/.test(trimmed)) {
        runLocal();
        return;
      }
      // Resolve explicit Note density locally first: an ambiguous target must not be guessed by a model.
      if (!attachments?.length && /^(?:请\s*)?(?:展开|收起|折叠|(?:把|将).+(?:展开|收起|折叠)[。！!]?$)/.test(trimmed)) {
        runLocal();
        return;
      }
      const requestId = newId("intent");
      const controller = new AbortController();
      const expiresAt = Date.now() + INTENT_TIMEOUT_MS;
      const isCurrent = () => pending.current?.requestId === requestId &&
        host.getSnapshot().activeCanvasId === activeCanvasId &&
        host.getSnapshot().ownerMode === "owner";
      pending.current = {
        requestId,
        canvasId: activeCanvasId,
        controller,
        deadlineTimer: setTimeout(() => controller.abort(new DOMException("请求超时", "TimeoutError")), INTENT_TIMEOUT_MS),
        slowTimer: setTimeout(() => {
          if (!isCurrent()) return;
          const text = "响应较慢，仍在处理…";
          setFeedback(text);
          host.setActivity(requestId, { requestId, text, expiresAt, phase: "thinking" });
        }, 5000),
      };
      setBusy(true);
      setFeedback("正在理解你的指令…");
      host.setActivity(requestId, { requestId, text: "让我想想…", expiresAt, phase: "thinking" });
      // Backend-first: /api/intent (rules-first, then LLM planner when a key
      // exists). When the local API is offline, fall back to the in-browser
      // rules — an explicit offline mode, surfaced in the mode pill.
      void (async () => {
        try {
          const result = await postIntent(
            trimmed,
            buildCanvasContext(canvasStore.getState(), activeCanvasId),
            controller.signal,
            attachments,
            continuation,
          );
          if (!isCurrent()) return;
          setBackendOnline(true);
          if (result.kind === "envelope" && result.envelope) {
            const res = host.dispatch(result.envelope);
            setFeedback(
              res.ok
                ? result.envelope.spokenText ?? "已执行"
                : `指令未执行（${res.ok ? "" : res.error}）`,
            );
            if (res.ok && !res.deduplicated && result.envelope.spokenText) {
              void speakText(result.envelope.spokenText, { requestId: result.envelope.requestId });
            }
          } else {
            // No envelope (rules miss / model offline / planner failed):
            // the in-browser parser knows the local references better — try
            // it before surfacing the server's honest "can't do that" line.
            const local = attachments?.length ? { kind: "unknown" as const, message: result.message ?? "图片分析未完成。" } : parseCommand(trimmed, {
              state: canvasStore.getState(),
              canvasId: activeCanvasId,
            });
            if (local.kind !== "unknown") {
              applyResult(host, local);
            } else {
              setFeedback(result.message ?? local.message);
              if (result.kind === "clarify" && result.message) previousQuestion.current = {
                canvasId: activeCanvasId, utterance: continuation?.utterance ?? trimmed,
                question: result.message.slice(0, 180), at: Date.now(),
              };
            }
          }
        } catch (error) {
          if (!isCurrent()) return;
          if (error instanceof DOMException && error.name === "TimeoutError") {
            setFeedback("本次请求超时，请重试。");
            return;
          }
          setBackendOnline(false);
          if (attachments?.length) { setFeedback("图片分析服务暂不可达，未执行任何动作；文字输入仍可使用。"); return; }
          runLocal();
          setFeedback((prev) => (prev ? `离线本地模式 · ${prev}` : prev));
        } finally {
          if (pending.current?.requestId === requestId) {
            clearTimeout(pending.current.slowTimer);
            clearTimeout(pending.current.deadlineTimer);
            pending.current = null;
            host.setActivity(requestId, null);
            setBusy(false);
          }
        }
      })();
    },
    [host, applyResult, cancelPending],
  );

  const pickClarify = useCallback(
    (candidate: ResolvedCard) => {
      if (!host || !clarify) return;
      const { activeCanvasId, ownerMode } = host.getSnapshot();
      if (!activeCanvasId || ownerMode !== "owner" || !clarify.candidates.some(item => item.card.id === candidate.card.id)) return;
      if (clarify.canvasId && clarify.canvasId !== activeCanvasId) { setClarify(null); setFeedback("画布已变更，请重新指定卡片。"); return; }
      const current = canvasStore.getState().cards.find(item => item.record.id === candidate.card.id && !item.exitingRequestId)?.record;
      const action = current ? clarifiedCardAction(clarify.action, current) : null;
      if (!action) { setClarify(null); setFeedback("目标已变更，请重新指定卡片。"); return; }
      const verb = { delete: "删除", focus: "聚焦", expand: "展开", collapse: "收起" }[clarify.action];
      const message = `已${verb}${candidate.label}`;
      const res = host.dispatch({
        schemaVersion: "0.6",
        requestId: newId("cmd"),
        canvasId: activeCanvasId ?? "",
        spokenText: message,
        actions: action.type === "card.update" && action.variant !== undefined ? [action, { type: "canvas.fit" }] : [action],
      });
      setClarify(null);
      setFeedback(res.ok ? `${message}${clarify.action === "delete" ? "，可撤销" : ""}` : res.error);
      if (res.ok) void speakText(message, { requestId: newId("speech") });
    },
    [host, clarify],
  );

  if (!host) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-500">
        正在载入本地画布…
      </div>
    );
  }

  return (
    <ControlShell
      host={host}
      clarify={clarify}
      feedback={feedback}
      onSubmit={submitCommand}
      onPickClarify={pickClarify}
      onCancelClarify={() => setClarify(null)}
      backendOnline={backendOnline}
      onBackendChange={setBackendOnline}
      busy={busy}
      onCancel={cancelPending}
    />
  );
};

interface ShellProps {
  host: ControlHost;
  clarify: ClarifyState | null;
  feedback: string | null;
  backendOnline: boolean | null;
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  onPickClarify: (candidate: ResolvedCard) => void;
  onCancelClarify: () => void;
  onBackendChange: (online: boolean) => void;
  busy: boolean;
  onCancel: () => void;
}

const ControlShell = (props: ShellProps) => {
  const snap = useSyncExternalStore(props.host.subscribe, props.host.getSnapshot);
  const readonly = snap.ownerMode !== "owner";

  const openDisplay = () => {
    const id = snap.activeCanvasId ?? "";
    window.open(`/display?canvasId=${encodeURIComponent(id)}`, "_blank");
  };

  return (
    <div
      className="min-h-screen bg-neutral-50 text-neutral-900"
      data-vivic-control="ready"
      data-vivic-owner={snap.ownerMode}
      data-vivic-active-canvas={snap.activeCanvasId ?? ""}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Vivic 控制端</h1>
          <span className="text-xs text-neutral-500">
            文字指令 · 提醒 · 画布管理
          </span>
        </header>

        {readonly && (
          <div
            className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            data-vivic-readonly-notice
          >
            <span>另一个控制窗口正在写入，本窗口为只读。</span>
            <button
              type="button"
              className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium hover:bg-amber-100"
              onClick={() => props.host.takeover()}
              data-vivic-takeover
            >
              接管控制权
            </button>
          </div>
        )}

        <AiSection disabled={readonly || !snap.ready} onBackendChange={props.onBackendChange} />
        <LocalSpeechSettings disabled={readonly || !snap.ready} onBeforeClear={props.onCancel} />

        <CommandSection
          ownerKey={`${snap.activeCanvasId}:${snap.ownerMode}`}
          disabled={readonly || !snap.ready}
          clarify={props.clarify}
          feedback={props.feedback}
          backendOnline={props.backendOnline}
          onSubmit={props.onSubmit}
          onPickClarify={props.onPickClarify}
          onCancelClarify={props.onCancelClarify}
          busy={props.busy}
          onCancel={props.onCancel}
        />

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openDisplay}
              disabled={!snap.activeCanvasId}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              data-vivic-open-display
            >
              打开 Vivic 展示窗口
            </button>
            <p className="text-xs text-neutral-500">
              把打开的窗口拖到第二屏，按 F11 或 ⌃⌘F 全屏；本页负责全部输入与设置。
            </p>
          </div>
        </section>

        <CanvasManager
          host={props.host}
          canvases={snap.canvases}
          activeCanvasId={snap.activeCanvasId}
          readonly={readonly}
        />
        <CanvasSettings host={props.host} disabled={readonly || !snap.ready} />

        <RemindersSection host={props.host} readonly={readonly} />

        <DataActions host={props.host} readonly={readonly} />
      </div>
    </div>
  );
};
