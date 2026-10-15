import type { Action, CardRecord } from "@/contracts";
import { newId } from "@/lib/id";
import type { VivicState } from "@/state/canvasStore";
import { resolveReference, type ResolvedCard } from "./references";
import { zhToNumber } from "./zhNumber";

export { zhToNumber };

/**
 * Local rules-only command parser (no LLM; Winnow/StepFun arrive in Phase 2).
 * Chinese-first. Everything it emits is a validated Action set — never DOM
 * mutation. Destructive intent with low confidence returns `clarify` instead
 * of acting (candidates get highlighted on stage; the user picks in /control).
 */

export interface CommandContext {
  state: VivicState;
  canvasId: string;
  now?: () => number;
}

export type CommandClarifyAction = "delete" | "focus" | "expand" | "collapse";

export type CommandResult =
  | {
      kind: "envelope";
      actions: Action[];
      spokenText?: string;
      description: string;
    }
  | {
      kind: "clarify";
      action: CommandClarifyAction;
      candidates: ResolvedCard[];
      prompt: string;
    }
  | { kind: "undo" }
  | { kind: "unknown"; message: string };

// ---------------------------------------------------------------- zh numerals
const DURATION_TOKEN = "(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十半]+)";

const parseDurationSeconds = (text: string): number | null => {
  const minMatch = text.match(new RegExp(`${DURATION_TOKEN}\\s*分(?:钟)?`));
  const secMatch = text.match(new RegExp(`${DURATION_TOKEN}\\s*秒`));
  if (!minMatch && !secMatch) return null;
  const minutes = minMatch ? zhToNumber(minMatch[1]!) : 0;
  const seconds = secMatch ? zhToNumber(secMatch[1]!) : 0;
  if (minutes === null || seconds === null) return null;
  const total = Math.round(minutes * 60 + seconds);
  return total >= 5 && total <= 24 * 3600 ? total : null;
};

// ------------------------------------------------------------------ builders
const builtinLayout = { x: 0, y: 0, width: 264, height: 96, pinned: false };

const countdownCard = (seconds: number, now: number): CardRecord => {
  const ts = new Date(now).toISOString();
  return {
    id: newId("countdown"),
    type: "CountdownCard",
    variant: "minimal",
    displayProps: {},
    sourceData: {
      targetAt: new Date(now + seconds * 1000).toISOString(),
      startedAt: ts,
    },
    sources: [],
    layout: builtinLayout,
    metadata: { createdAt: ts, updatedAt: ts },
  };
};

const todoCard = (items: string[], now: number): CardRecord | null => {
  const cleaned = items
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (cleaned.length === 0 || cleaned.some((t) => t.length > 160)) return null;
  const ts = new Date(now).toISOString();
  return {
    id: newId("todo"),
    type: "TodoCard",
    variant: "minimal",
    displayProps: {
      items: cleaned.map((text, i) => ({ id: `item-${i + 1}`, text, done: false })),
    },
    sourceData: {},
    sources: [],
    layout: { ...builtinLayout, width: 288, height: 160 },
    metadata: { createdAt: ts, updatedAt: ts },
  };
};

const withAwaken = (ctx: CommandContext, actions: Action[]): Action[] =>
  ctx.state.stage === "STANDBY"
    ? [{ type: "stage.awaken" }, ...actions]
    : actions;

/** Shared by direct commands and candidate confirmation: expansion must never become focus. */
export const clarifiedCardAction = (intent: CommandClarifyAction, card: CardRecord): Action | null => {
  if (intent === "expand" || intent === "collapse") {
    return card.type === "NoteCard" ? { type: "card.update", targetId: card.id, variant: intent === "expand" ? "expanded" : "minimal" } : null;
  }
  return intent === "delete" ? { type: "card.delete", targetId: card.id } : { type: "card.focus", targetId: card.id };
};

// Closed single-reference grammar: a compound/negative instruction must not partially execute.
const noteReference = /^(?:(?:(?:这|那)(?:一)?(?:张|个)?|刚才(?:那(?:张|个))?|最近|左边|右边|中间|中央|第(?:[一二两三四五六七八九十]|\d+)(?:张|个))(?:的)?)?(?:便笺|便签|笔记|note)(?:卡片|卡)?$/i;
const implicitNoteReference = /^(?:(?:这|那)(?:张|个)(?:卡片|卡)?|它|刚才那个|最近那个|第(?:[一二两三四五六七八九十]|\d+)(?:张|个))$/;

// -------------------------------------------------------------------- parser
export const parseCommand = (
  rawInput: string,
  ctx: CommandContext,
): CommandResult => {
  const input = rawInput.trim();
  const now = ctx.now?.() ?? Date.now();
  if (!input) return { kind: "unknown", message: "请输入指令" };

  // canvas-level views
  if (/^(显示全部|全部显示|看全部|适应画布|fit)$/i.test(input)) {
    return {
      kind: "envelope",
      actions: withAwaken(ctx, [{ type: "canvas.fit" }]),
      spokenText: "已显示全部卡片",
      description: "显示全部",
    };
  }
  if (/^(恢复原视图|恢复刚才的画面|恢复视图|退出聚焦|取消聚焦|restore)$/i.test(input)) {
    return {
      kind: "envelope",
      actions: withAwaken(ctx, [{ type: "canvas.restore" }]),
      spokenText: "已恢复原视图",
      description: "恢复原视图",
    };
  }
  if (/^(撤销|撤销删除)$/.test(input)) return { kind: "undo" };
  if (/^唤醒$/.test(input)) {
    return {
      kind: "envelope",
      actions: [{ type: "stage.awaken" }],
      description: "唤醒",
    };
  }

  // Note density is an explicit data action; card.focus remains camera-only.
  const prefixDensity = input.match(/^(?:请\s*)?(展开|收起|折叠)\s*(.+?)[。！!]?$/);
  const suffixDensity = input.match(/^(?:请\s*)?(?:把|将)\s*(.+?)\s*(展开|收起|折叠)[。！!]?$/);
  const density = prefixDensity ? { operation: prefixDensity[1], reference: prefixDensity[2]! }
    : suffixDensity ? { operation: suffixDensity[2], reference: suffixDensity[1]! } : null;
  if (density) {
    const operation = density.operation === "展开" ? "expand" : "collapse";
    const verb = operation === "expand" ? "展开" : "收起";
    const reference = density.reference.replace(/\s+/g, "");
    if (!noteReference.test(reference) && !implicitNoteReference.test(reference)) {
      return { kind: "unknown", message: "只支持展开或收起便笺，请完整指定一张便笺，例如「展开左边的便笺」。" };
    }
    const normalized = reference.replace(/便笺/g, "便签");
    const target = noteReference.test(reference) ? normalized : `${normalized}便签`;
    let resolution = resolveReference(target, { state: ctx.state, now: ctx.now });
    // A current focused Note can disambiguate a generic request; never choose the newest Note.
    if (resolution.kind === "ambiguous" && ctx.state.focus && !/左|右|中间|中央|第|刚才|最近/.test(reference)) {
      const focused = resolution.candidates.find(candidate => candidate.card.id === ctx.state.focus!.cardId);
      if (focused) resolution = { kind: "unique", card: focused.card, label: focused.label };
    }
    if (resolution.kind === "none") return { kind: "unknown", message: "没有找到对应的便笺，请重新指定。" };
    if (resolution.kind === "ambiguous") return {
      kind: "clarify", action: operation, candidates: resolution.candidates,
      prompt: `你想${verb}哪张便笺？`,
    };
    const action = clarifiedCardAction(operation, resolution.card);
    if (!action) return { kind: "unknown", message: "只能展开或收起便笺。" };
    return { kind: "envelope", actions: withAwaken(ctx, [action, { type: "canvas.fit" }]), spokenText: `已${verb}${resolution.label}`, description: `${verb}${resolution.label}` };
  }

  // delete by reference (checked before creates: 删掉倒计时 ≠ make one)
  const deleteMatch = input.match(/^(?:删除|删掉|删了|删|移除|去掉)\s*(.+)$/);
  if (deleteMatch) {
    const resolution = resolveReference(deleteMatch[1]!, {
      state: ctx.state,
      now: ctx.now,
    });
    if (resolution.kind === "none") {
      return {
        kind: "unknown",
        message: resolution.reason ?? "没有找到对应的卡片",
      };
    }
    if (resolution.kind === "ambiguous") {
      return {
        kind: "clarify",
        action: "delete",
        candidates: resolution.candidates,
        prompt: "你要删除哪一个？",
      };
    }
    return {
      kind: "envelope",
      actions: withAwaken(ctx, [
        { type: "card.delete", targetId: resolution.card.id },
      ]),
      spokenText: `已删除${resolution.label}`,
      description: `删除${resolution.label}`,
    };
  }

  // focus by reference
  const focusMatch = input.match(/^(?:放大|聚焦|看一看|看下|看看|focus)\s*(.+)$/i);
  if (focusMatch) {
    const resolution = resolveReference(focusMatch[1]!, {
      state: ctx.state,
      now: ctx.now,
    });
    if (resolution.kind === "none") {
      return {
        kind: "unknown",
        message: resolution.reason ?? "没有找到对应的卡片",
      };
    }
    if (resolution.kind === "ambiguous") {
      return {
        kind: "clarify",
        action: "focus",
        candidates: resolution.candidates,
        prompt: "你想放大哪一个？",
      };
    }
    return {
      kind: "envelope",
      actions: withAwaken(ctx, [
        { type: "card.focus", targetId: resolution.card.id },
      ]),
      spokenText: `已聚焦${resolution.label}`,
      description: `聚焦${resolution.label}`,
    };
  }

  // countdown: 十分钟倒计时 / 10分钟倒计时 / 倒计时 5 分 30 秒 / 创建倒计时
  const countdownMatch =
    input.match(new RegExp(`^(?:创建|新建|设|定|来一?个)?\\s*(.+?)\\s*倒计时$`)) ??
    input.match(/^倒计时\s*(.+)$/);
  if (countdownMatch) {
    const seconds = parseDurationSeconds(countdownMatch[1] ?? "");
    if (seconds) {
      const card = countdownCard(seconds, now);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const label = mins > 0 ? `${mins}分${secs > 0 ? `${secs}秒` : ""}` : `${secs}秒`;
      return {
        kind: "envelope",
        actions: withAwaken(ctx, [{ type: "card.create", card }]),
        spokenText: `${label}倒计时已就位`,
        description: `创建 ${label} 倒计时`,
      };
    }
    return { kind: "unknown", message: "没听清倒计时多久，例如「十分钟倒计时」" };
  }

  // todo: 加待办：a；b；c / 添加待办 买菜 / 待办：写报告，回邮件
  const todoMatch =
    input.match(/^(?:加|添加|新增|创建|列)(?:个|一条|几条|下)?\s*待办\s*[:：]?\s*(.+)$/) ??
    input.match(/^待办\s*[:：]\s*(.+)$/);
  if (todoMatch) {
    const items = todoMatch[1]!.split(/[;；,，、\n]+/);
    const card = todoCard(items, now);
    if (!card) {
      return { kind: "unknown", message: "待办为空或单条超过 160 字" };
    }
    const count = card.type === "TodoCard" ? card.displayProps.items.length : 0;
    return {
      kind: "envelope",
      actions: withAwaken(ctx, [{ type: "card.create", card }]),
      spokenText: `已记下 ${count} 条待办`,
      description: `创建待办（${count} 项）`,
    };
  }

  return {
    kind: "unknown",
    message:
      "暂时只懂这些指令：倒计时 / 加待办 / 放大… / 展开便笺 / 收起便笺 / 删除… / 显示全部 / 恢复原视图 / 撤销（搜索、天气等联网能力在 Phase 2 接入）",
  };
};
