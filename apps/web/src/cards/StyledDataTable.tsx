import { useLayoutEffect, useRef } from "react";
import { renderVivicSpec } from "./vivicGUILibrary";

/** One-based ORIGINAL row position; never a cell's text, value, or an inferred ID. */
const tableRowItemId = (index: number) => `row:${index + 1}`;

// Null/missing/nonfinite cells stay missing, never become fabricated zeros.
const displayCell = (value: unknown): string | number | boolean => {
  if (typeof value === "number") return Number.isFinite(value) ? value : "—";
  return typeof value === "string" || typeof value === "boolean" ? value : "—";
};

/** Uses the installed styled Table renderer, including its real header/cell markup. */
export const StyledDataTable = ({
  columns,
  rows,
  highlightedItemId,
  maxHeight,
}: {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  highlightedItemId?: string;
  maxHeight: number;
}) => {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Table exposes no row props. Annotate only this instance's existing rows;
    // do not replace the component, depend on private imports, or enable sorting.
    container.current?.querySelectorAll("tbody > tr").forEach((row, index) => {
      const id = tableRowItemId(index);
      row.setAttribute("data-vivic-row-id", id);
      if (id === highlightedItemId) {
        row.setAttribute("data-vivic-highlighted", "true");
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("data-vivic-highlighted");
        row.removeAttribute("aria-current");
      }
    });
  }, [columns, rows, highlightedItemId]);

  return <div
    ref={container}
    className="nodrag nowheel min-w-0 overflow-auto"
    style={{ maxHeight }}
    tabIndex={0}
    data-vivic-data-table
  >
    {renderVivicSpec({
      _type: "Table",
      columns: columns.map(label => ({ label })),
      rows: rows.map(row => columns.map((_, index) => displayCell(row[index]))),
      sortable: false,
    })}
  </div>;
};
