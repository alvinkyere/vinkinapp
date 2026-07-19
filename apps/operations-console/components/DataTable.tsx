import { formatMoney } from '../lib/money';
import type { Row } from '../lib/types';

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (key.endsWith('_minor')) return formatMoney(value as number | string);
  if (key.endsWith('_at') && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Renders an array of raw DB rows as a table — columns are the union of keys present,
 * in first-seen order. Deliberately generic (see module comment in lib/types.ts): this is
 * an inspection tool over whatever the backend actually stores, not a bespoke view per
 * table, which is exactly the "don't build a broad admin platform" instruction in practice. */
export function DataTable({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-500"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => (
                <td key={column} className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">
                  {formatCell(column, row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
