import type { TodoCard } from "@/contracts";
import { renderVivicSpec } from "./vivicGUILibrary";
import { SubcardAnchor } from "./SubcardAnchor";

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
  return <div className="flex flex-col gap-2">{items.map(item => <div key={item.id} data-vivic-todo-row={item.id}>
    <SubcardAnchor card={card} itemId={item.id}>{renderVivicSpec({ _type: "TodoItem", text: item.text, done: item.done, highlighted: item.id === highlightedItemId })}</SubcardAnchor>
  </div>)}</div>;
};
