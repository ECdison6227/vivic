import type { TodoCard } from "@/contracts";
import { renderVivicSpec } from "./vivicGUILibrary";

const MAX_VISIBLE_ITEMS = 5;

/** Minimal todo: checkbox state + text only, first N items. */
export const TodoCardView = ({
  card,
  highlightedItemId,
}: {
  card: TodoCard;
  highlightedItemId?: string;
}) => {
  const items = card.displayProps.items.slice(0, MAX_VISIBLE_ITEMS);
  return renderVivicSpec({
    _type: "Col",
    gap: 2,
    children: items.map((item) => ({
      _type: "TodoItem",
      _key: item.id,
      text: item.text,
      done: item.done,
      highlighted: item.id === highlightedItemId,
    })),
  });
};
