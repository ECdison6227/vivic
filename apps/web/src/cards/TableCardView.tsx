import type { TableCard } from "./dataCardTypes";
import { StyledDataTable } from "./StyledDataTable";

export const TableCardView = ({ card, highlightedItemId }: {
  card: TableCard;
  highlightedItemId?: string;
}) => <StyledDataTable
  card={card}
  columns={card.displayProps.columns}
  rows={card.displayProps.rows}
  highlightedItemId={highlightedItemId}
  maxHeight={Math.max(56, card.layout.height - 32)}
/>;
