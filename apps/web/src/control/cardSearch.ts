import PinyinMatch from "pinyin-match";
import { cardTitle, type CardRecord } from "@/contracts";

export const CARD_TYPE_LABELS: Record<CardRecord["type"], string> = {
  NoteCard: "便笺", TodoCard: "待办", CountdownCard: "提醒 / 计时", SearchResultCard: "搜索 / 文章", WeatherCard: "天气", TableCard: "表格", ChartCard: "图表",
};

export const cardSearchText = (card: CardRecord): string[] => [cardTitle(card), ...(card.metadata.aliases ?? []),
  ...(card.type === "NoteCard" ? [card.displayProps.text ?? "", ...(card.displayProps.bullets ?? [])]
    : card.type === "TodoCard" ? card.displayProps.items.map(item => item.text)
    : card.type === "CountdownCard" ? [card.sourceData.reminderText ?? ""]
    : card.type === "SearchResultCard" ? [card.displayProps.title, card.displayProps.summary] : [])];

export function cardMatches(card: CardRecord, query: string): boolean {
  const normalized = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!normalized) return true;
  return cardSearchText(card).some(text => {
    const value = text.normalize("NFKC").toLocaleLowerCase();
    return value.includes(normalized) || Boolean(PinyinMatch.match(value, normalized));
  });
}

export const cardSearchSummary = (card: CardRecord): string => (card.type === "SearchResultCard" ? card.displayProps.summary
  : card.type === "TodoCard" ? card.displayProps.items.map(item => item.text).join(" · ")
  : card.type === "NoteCard" ? [card.displayProps.text, ...(card.displayProps.bullets ?? [])].filter(Boolean).join(" · ")
  : card.type === "CountdownCard" ? card.sourceData.reminderText ?? "纯数字计时器"
  : CARD_TYPE_LABELS[card.type]);

/** A scan-friendly label only; matching and stored originals remain intact. */
export const searchPreview = (text: string, maxLength = 100): string => text
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/[`*_~]/g, "")
  .replace(/\s+/g, " ").trim().slice(0, maxLength);
