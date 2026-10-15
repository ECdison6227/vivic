import type { NoteCard } from "./dataCardTypes";
import { renderVivicSpec } from "./vivicGUILibrary";

/** Density changes only with the stored variant; Display adds no expand button. */
export const NoteCardView = ({ card }: { card: NoteCard }) => <div
  className="min-w-0 whitespace-pre-wrap break-words"
  style={card.variant === "expanded" ? undefined : {
    maxHeight: Math.max(24, Math.min(card.layout.height - 32, card.variant === "minimal" ? 72 : 144)),
    overflow: "hidden",
  }}
  data-vivic-note-variant={card.variant}
>
  {renderVivicSpec({
    _type: "Col",
    gap: 2,
    children: [
      card.displayProps.text ? { _type: "Text", value: card.displayProps.text } : null,
      ...(card.displayProps.bullets ?? []).map((bullet, index) => ({
        _type: "Text",
        _key: String(index),
        value: `• ${bullet}`,
        color: "secondary",
      })),
    ],
  })}
</div>;
