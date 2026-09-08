import type { Column, ConstraintDef, IndexDef, Table } from './types';
import { formatType, formatValue } from './format';

/**
 * One-line descriptions of schema entities, so a column reads the same way
 * wherever it is shown. Each `*Meta` returns the *trailing* metadata only; the
 * entity's name is rendered separately, in mono, as the row's subject.
 */

export function columnMeta(c: Column): string {
  const parts = [formatType(c)];
  if (c.primaryKey) parts.push('primary key');
  parts.push(c.nullable ? 'nullable' : 'not null');
  if (c.default !== undefined) parts.push(`default ${c.default}`);
  return parts.join(' · ');
}

export function indexMeta(i: IndexDef, columnName: (id: string) => string): string {
  const cols = i.columnIds.map(columnName).join(', ');
  return [i.unique ? 'unique index' : 'index', cols || '—'].join(' · ');
}

export function constraintMeta(c: ConstraintDef): string {
  return [c.type.replace('_', ' '), c.definition].join(' · ');
}

/**
 * Index and constraint definitions carry column *ids*; a row needs names.
 * Looks through every source it is given — tables, or loose column lists such
 * as a diff's removed columns — so a lookup still resolves when the column
 * exists on only one side of the comparison.
 */
export function columnNamer(...sources: (Table | Column[] | undefined)[]) {
  const columns = sources.flatMap((s) => (Array.isArray(s) ? s : (s?.columns ?? [])));
  return (id: string): string => columns.find((c) => c.id === id)?.name ?? '?';
}

/** Column-id arrays read as ids otherwise; map them back to names. */
export function formatField(
  field: string,
  value: unknown,
  columnName: (id: string) => string
): string {
  if (field !== 'columnIds' || !Array.isArray(value)) return formatValue(value);
  return value.length ? value.map((id) => columnName(String(id))).join(', ') : '—';
}

