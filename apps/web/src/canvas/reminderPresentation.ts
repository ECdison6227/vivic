import type { CountdownCard } from "@/contracts";
import type { CardState } from "@/state/canvasStore";
import { CARD_INNER_HEIGHT } from "@/cards/metrics";
export const completedCountdown = (entry: CardState) => entry.record.type === "CountdownCard" && Boolean(entry.record.sourceData.notifiedAt) && !entry.record.sourceData.schedule;
export const groupedReminder = (entry: CardState) => entry.record.type === "CountdownCard" && Boolean(entry.record.sourceData.reminderText) && !entry.record.layout.pinned && !entry.exitingRequestId && !completedCountdown(entry);
export interface PresentedCard { entry: CardState; reminders?: CountdownCard[]; memberIds: string[] }
/** Derived view only: preserve every timer's ID, task, pause state and delivery.
 * Pinned cards remain separate; completed timers stay available to Control and
 * conditions but occupy no display/layout space. */
export function presentCards(cards: CardState[]): PresentedCard[] {
  const group = cards.filter(groupedReminder);
  const anchor = group[0];
  return cards.flatMap(entry => {
    if (completedCountdown(entry) && !entry.exitingRequestId) return [];
    if (!groupedReminder(entry)) return [{ entry, memberIds: [entry.record.id] }];
    if (entry !== anchor) return [];
    const reminders = group.map(item => item.record as CountdownCard);
    const width = Math.max(360, entry.record.layout.width);
    const chars = Math.max(1, Math.floor((width - 168) / 18));
    const height = CARD_INNER_HEIGHT + reminders.reduce((sum, card) => sum + Math.max(56, Math.ceil(card.sourceData.reminderText!.length / chars) * 27 + 20), 0);
    return [{ entry: { ...entry, record: { ...entry.record, layout: { ...entry.record.layout, width, height } } }, reminders, memberIds: reminders.map(card => card.id) }];
  });
}
