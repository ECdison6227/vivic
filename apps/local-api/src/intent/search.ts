import { randomUUID } from "node:crypto";
import { ActionEnvelopeSchema } from "@vivic/contracts";
import type { CanvasContext } from "../schemas.js";
import type { SearchEvidence } from "../search/index.js";
import { publicHttpsUrl } from "../search/policy.js";
import { chineseNumber } from "./reminders.js";
import type { SearchSummary } from "./searchSummary.js";

/** Conservative, explicit query entry. Mixed destructive instructions stay in
 * the planner instead of quietly executing only their search clause. */
export const searchQuery = (text: string): string | null => {
  const raw = text.trim();
  if (/^(?:查看|查询当前|查询刚才)/.test(raw) || /[，,；;]\s*(?:再|并|然后)?\s*(?:删除|取消|放大|聚焦|创建|添加)/.test(raw)) return null;
  const match = raw.match(/^(?:请帮我|请|帮我)?\s*(?:搜索|搜一下|搜一搜|搜|查找|查一下|查一查|查查|查询|查)\s*(.+)$/);
  return match?.[1]?.trim() || null;
};
const textOnly = (text: string, max: number) => text.replace(/<[^>]*>/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The tool's citations remain data. No webpage text is interpreted as actions
 * or forwarded to a model, and no claim of full-page reading is made. */
export const buildSearchEnvelope = (query: string, ctx: CanvasContext, results: SearchEvidence[], summary?: SearchSummary) => {
  const countMatch = query.match(/([一二两三四五六七八九十\d]+)\s*(?:个|款|种|家|条|篇)/);
  const count = Math.min(5, Math.max(1, (countMatch ? chineseNumber(countMatch[1]!) : null) ?? 3));
  const unique = new Set<string>();
  const rows = results.filter(result => {
    try {
      const url = publicHttpsUrl(result.url).href;
      if (unique.has(url) || !Number.isFinite(Date.parse(result.fetchedAt))) return false;
      unique.add(url); return true;
    } catch { return false; }
  }).slice(0, count);
  if (!rows.length) return null;
  const stamp = new Date().toISOString();
  const items = summary?.slice(0, count).map(item => ({ title: item.title, snippet: item.summary,
    sources: [...new Set(item.sourceIndices)].map(index => results[index]!).filter(Boolean), summarized: true }))
    ?? rows.map(row => ({ title: row.title, snippet: row.snippet, sources: [row], summarized: false }));
  const actions = items.map((item, index) => {
    const row = item.sources[0]!;
    const url = publicHttpsUrl(row.url);
    const excerpt = textOnly(item.snippet, 700);
    const firstSentence = excerpt.match(/^.*?[。！？]|^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? excerpt;
    return { type: "card.create" as const, card: {
      id: `search_${randomUUID()}`, type: "SearchResultCard" as const, variant: "minimal" as const,
      displayProps: { title: textOnly(item.title, 140) || url.hostname,
        summary: (item.summarized ? excerpt : firstSentence).slice(0, 240), sourceLabel: url.hostname },
      sourceData: { query, excerpt: textOnly(item.sources.map(source => source.snippet).join("\n"), 3500), summaryMethod: item.summarized ? "model-cited-evidence" : "provider-excerpt" },
      sources: item.sources.map(source => ({ title: textOnly(source.title, 500), url: publicHttpsUrl(source.url).href, fetchedAt: source.fetchedAt,
        provider: source.provider, readFullPage: false })),
      layout: { x: (index % 3) * 308, y: Math.floor(index / 3) * 180, width: 288, height: 180, pinned: false },
      metadata: { createdAt: stamp, updatedAt: stamp, aliases: [textOnly(item.title, 80)] },
    } };
  });
  return ActionEnvelopeSchema.parse({ schemaVersion: "0.6", requestId: `search_${randomUUID()}`,
    canvasId: ctx.canvasId, spokenText: `已整理 ${items.length} 条结果`,
    actions: [...(ctx.stage === "STANDBY" ? [{ type: "stage.awaken" }] : []), ...actions, { type: "canvas.fit" }],
  });
};
