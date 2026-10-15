import type { NoteCard } from "./dataCardTypes";
import { Fragment } from "react";
import { renderVivicSpec } from "./vivicGUILibrary";
import { SubcardAnchor } from "./SubcardAnchor";

/** Density changes only with the stored variant; Display adds no expand button. */
export const NoteCardView = ({ card }: { card: NoteCard }) => <div
  className="min-w-0 whitespace-pre-wrap break-words"
  style={card.variant === "expanded" ? undefined : {
    maxHeight: Math.max(24, Math.min(card.layout.height - 32, card.variant === "minimal" ? 72 : 144)),
    overflow: "hidden",
  }}
  data-vivic-note-variant={card.variant}
>
  <div>{card.displayProps.text?.split("\n").map((line, index, lines) => <Fragment key={`line:${index + 1}`}>
    <div className="vivic-note-line"><SubcardAnchor card={card} itemId={`line:${index + 1}`}>{renderVivicSpec({ _type: "Text", value: line })}</SubcardAnchor></div>
    {index < lines.length - 1 ? "\n" : null}
  </Fragment>)}</div>
  {(card.displayProps.bullets ?? []).map((bullet, index) => <div className="mt-2" key={`bullet:${index + 1}`}>
    <SubcardAnchor card={card} itemId={`bullet:${index + 1}`}>{renderVivicSpec({ _type: "Text", value: `• ${bullet}`, color: "secondary" })}</SubcardAnchor>
  </div>)}
</div>;
