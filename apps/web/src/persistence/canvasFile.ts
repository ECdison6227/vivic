import { z } from "zod";
import { CardRecordSchema, ViewportSchema } from "@/contracts";
import type { CanvasRecord } from "./canvasRecord";

/** JSON export/import file shape — validated with the same strict schemas. */
export const CanvasFileSchema = z.strictObject({
  schemaVersion: z.literal("0.6"),
  app: z.literal("vivic"),
  exportedAt: z.iso.datetime(),
  canvas: z.strictObject({
    title: z.string().min(1).max(120),
    cards: z.array(CardRecordSchema).max(200),
    viewport: ViewportSchema,
    focusHistory: z.array(z.string().min(1).max(128)).max(20).default([]),
  }),
});

export type CanvasFile = z.infer<typeof CanvasFileSchema>;

export const toCanvasFile = (record: CanvasRecord): CanvasFile => ({
  schemaVersion: "0.6",
  app: "vivic",
  exportedAt: new Date().toISOString(),
  canvas: {
    title: record.title,
    cards: record.cardOrder
      .map((id) => record.cardsById[id])
      .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    viewport: record.viewport,
    focusHistory: record.focusHistory,
  },
});

export type ParseFileResult =
  | { ok: true; file: CanvasFile }
  | { ok: false; error: string };

export const parseCanvasFile = (text: string): ParseFileResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是有效的 JSON 文件" };
  }
  const parsed = CanvasFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `文件校验失败：${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  }
  return { ok: true, file: parsed.data };
};

export const fileToCanvasRecord = (
  file: CanvasFile,
  id: string,
): CanvasRecord => ({
  id,
  title: file.canvas.title,
  version: 0,
  updatedAt: new Date().toISOString(),
  cardsById: Object.fromEntries(file.canvas.cards.map((c) => [c.id, c])),
  cardOrder: file.canvas.cards.map((c) => c.id),
  viewport: file.canvas.viewport,
  focusHistory: file.canvas.focusHistory,
  processedRequestIds: [],
});
