import type { ReactNode } from 'react'

export interface ChartAccessibilityColumn<TRow> {
  key: string
  header: string
  render: (row: TRow) => ReactNode
}

interface ChartAccessibilityProps<TRow> {
  summaryId: string
  summary: string
  tableLabel?: string
  columns?: ChartAccessibilityColumn<TRow>[]
  rows?: TRow[]
}

export function ChartAccessibility<TRow,>({
  summaryId,
  summary,
  tableLabel,
  columns = [],
  rows = [],
}: ChartAccessibilityProps<TRow>) {
  return (
    <div id={summaryId} className="sr-only">
      <p>{summary}</p>
      {tableLabel && columns.length > 0 && rows.length > 0 ? (
        <table>
          <caption>{tableLabel}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
