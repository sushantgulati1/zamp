import type { Column } from './types';

/** `varchar(255)` — the type as it would read in a DDL statement. */
export function formatType(col: Pick<Column, 'type' | 'length'>): string {
  return col.length ? `${col.type}(${col.length})` : col.type;
}

/** Commit ids are long; the log only ever shows the leading characters. */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

export function formatTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Renders a single field value from a schema entity for the diff/conflict
 * tables. Distinguishes "absent" from the string "undefined", which matters
 * when the field is the whole point of the comparison.
 */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Human label for a conflict/diff field key. */
const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  type: 'type',
  length: 'length',
  nullable: 'nullable',
  default: 'default',
  primaryKey: 'primary key',
  columnIds: 'columns',
  unique: 'unique',
  definition: 'definition',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
