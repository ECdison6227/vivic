import type { CardRecord } from "@/contracts";
import type { HighlightState } from "@/state/canvasStore";
import { CountdownCardView } from "./CountdownCardView";
import { TodoCardView } from "./TodoCardView";
import { SearchResultCardView } from "./SearchResultCardView";
import { WeatherCardView } from "./WeatherCardView";
import { TableCardView } from "./TableCardView";
import { ChartCardView } from "./ChartCardView";
import { NoteCardView } from "./NoteCardView";

/**
 * Card registry renderer. Only registered, schema-gated types reach this
 * point — unknown types were rejected at the contract boundary and never hit
 * a React component.
 */
export const VivicCard = ({
  record,
  highlight,
}: {
  record: CardRecord;
  highlight?: HighlightState | null;
}) => {
  switch (record.type) {
    case "CountdownCard":
      return <CountdownCardView card={record} />;
    case "TodoCard":
      return (
        <TodoCardView
          card={record}
          highlightedItemId={
            highlight?.cardId === record.id ? highlight.itemId : undefined
          }
        />
      );
    case "SearchResultCard":
      return <SearchResultCardView card={record} />;
    case "NoteCard":
      return <NoteCardView card={record} />;
    case "WeatherCard":
      return <WeatherCardView card={record} />;
    case "TableCard":
      return <TableCardView
        card={record}
        highlightedItemId={highlight?.cardId === record.id ? highlight.itemId : undefined}
      />;
    case "ChartCard":
      return <ChartCardView card={record} />;
  }
};
