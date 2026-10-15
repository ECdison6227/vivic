import { z } from "zod";
import type { CountdownCard } from "@/contracts";

export const ReminderNoticeSchema = z.strictObject({
  id: z.string().min(1).max(128),
  canvasId: z.string().min(1).max(128),
  canvasTitle: z.string().min(1).max(120),
  cardId: z.string().min(1).max(128),
  text: z.string().min(1).max(160),
  targetAt: z.iso.datetime(),
  firedAt: z.iso.datetime(),
});
export const ReminderInboxSchema = z.array(ReminderNoticeSchema).max(50);
export type ReminderNotice = z.infer<typeof ReminderNoticeSchema>;

export interface ReminderSummary {
  canvasId: string;
  canvasTitle: string;
  card: CountdownCard;
}

/** Absolute wall-clock deadlines survive sleep and reload; intervals only poll. */
export const isDue = (card: CountdownCard, now: number): boolean =>
  !card.sourceData.pausedAt && !card.sourceData.notifiedAt &&
  Date.parse(card.sourceData.targetAt) <= now;

export const remainingSeconds = (card: CountdownCard, now: number): number =>
  Math.max(0, Math.ceil((Date.parse(card.sourceData.targetAt) -
    (card.sourceData.pausedAt ? Date.parse(card.sourceData.pausedAt) : now)) / 1000));

export const reminderText = (card: CountdownCard): string =>
  card.sourceData.reminderText ?? "倒计时已结束";

export const sameDelivery = (notice: ReminderNotice, item: ReminderSummary): boolean =>
  notice.canvasId === item.canvasId && notice.cardId === item.card.id &&
  notice.targetAt === item.card.sourceData.targetAt;
