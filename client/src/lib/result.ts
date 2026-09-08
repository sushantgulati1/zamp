import type { Column, ConstraintDef, IndexDef, Schema, Table } from './types';
import { columnMeta, columnNamer, constraintMeta, formatField, indexMeta } from './describe';

/**
 * The inventory the compare sheet renders: the target's tables as they will
 * stand after the merge, each entity marked with what the merge does to it.
 *
 * Built by comparing the **target tip against the merged schema** — never
 * against the source branch. Those two questions have different answers: the
 * source can carry a change the merge won't apply (the target already made a
 * newer edit to the same entity, or a conflict was resolved in its favour),
 * and marking such an entity as changed would promise an edit that never
 * happens. Everything the sheet reports — the change count, the drop warning,
 * the panel — comes off this one structure, so the summary can never claim a
 * change the panel doesn't show.
 */

export type State = 'add' | 'del' | 'mod' | 'same';

/** One field's before → after, already rendered for display. */
export interface Transition {
  field: string;
  from: string;
  to: string;
}

export interface ResultRow {
  key: string;
  state: State;
  name: string;
  meta: string;
  /** Field-level before → after, on redefined entities only. */
  fields?: Transition[];
}

export interface ResultTable {
  key: string;
  name: string;
  /** Set when the whole table is created or dropped by this merge. */
  state: State | null;
  renamedFrom?: string;
  /** Marks rendered for this table — what the merge does, not what diverged. */
  changes: number;
  columns: ResultRow[];
  indexes: ResultRow[];
  constraints: ResultRow[];
}

/** Every row the panel will draw for a table, in one list. */
export function rowsOf(table: ResultTable): ResultRow[] {
  return [...table.columns, ...table.indexes, ...table.constraints];
}

/** Total marks across every table — the sheet's headline change count. */
export function countChanges(tables: ResultTable[]): number {
  return tables.reduce((n, t) => n + t.changes, 0);
}

/** Whether the merge takes anything away, which is what warrants a closer look. */
export function hasDrops(tables: ResultTable[]): boolean {
  return tables.some((t) => t.state === 'del' || rowsOf(t).some((r) => r.state === 'del'));
}

/** Whether it redefines something that already exists, as against only adding. */
export function hasRewrites(tables: ResultTable[]): boolean {
  return tables.some((t) => Boolean(t.renamedFrom) || rowsOf(t).some((r) => r.state === 'mod'));
}

/**
 * @param before the target branch's tip — the schema being merged into
 * @param merged the schema the merge produces
 */
export function buildResultTables(before: Schema, merged: Schema): ResultTable[] {
  const out: ResultTable[] = [];

  for (const table of merged.tables) {
    const prior = before.tables.find((t) => t.id === table.id);
    out.push(counted(prior ? changedTable(prior, table) : wholeTable(table, 'add')));
  }

  for (const table of before.tables) {
    if (!merged.tables.some((t) => t.id === table.id)) out.push(counted(wholeTable(table, 'del')));
  }

  return out.filter((t) => t.changes > 0);
}

/** A table created or dropped wholesale: every entity carries the table's tone. */
function wholeTable(table: Table, state: 'add' | 'del'): Omit<ResultTable, 'changes'> {
  const name = columnNamer(table);
  return {
    key: table.id,
    name: table.name,
    state,
    columns: table.columns.map((c) => ({ key: c.id, state, name: c.name, meta: columnMeta(c) })),
    indexes: table.indexes.map((i) => ({
      key: i.id,
      state,
      name: i.name,
      meta: indexMeta(i, name),
    })),
    constraints: table.constraints.map((c) => ({
      key: c.id,
      state,
      name: c.name,
      meta: constraintMeta(c),
    })),
  };
}

/** A table present on both sides: entity by entity, what actually moves. */
function changedTable(prior: Table, live: Table): Omit<ResultTable, 'changes'> {
  const name = columnNamer(live, prior.columns);
  const format = (field: string, value: unknown) => formatField(field, value, name);

  const section = <T extends { id: string; name: string }>(
    priorList: T[],
    liveList: T[],
    meta: (e: T) => string
  ): ResultRow[] => [
    ...liveList.map((e) => row(e, priorList.find((p) => p.id === e.id), meta, format)),
    // Present before the merge, gone after it.
    ...priorList
      .filter((e) => !liveList.some((l) => l.id === e.id))
      .map((e) => ({ key: `d-${e.id}`, state: 'del' as const, name: e.name, meta: meta(e) })),
  ];

  return {
    key: live.id,
    name: live.name,
    state: null,
    renamedFrom: prior.name === live.name ? undefined : prior.name,
    columns: section<Column>(prior.columns, live.columns, columnMeta),
    indexes: section<IndexDef>(prior.indexes, live.indexes, (i) => indexMeta(i, name)),
    constraints: section<ConstraintDef>(prior.constraints, live.constraints, constraintMeta),
  };
}

/** One surviving entity: new to the target, redefined on it, or untouched. */
function row<T extends { id: string; name: string }>(
  live: T,
  prior: T | undefined,
  meta: (e: T) => string,
  format: (field: string, value: unknown) => string
): ResultRow {
  const base = { key: live.id, name: live.name, meta: meta(live) };
  if (!prior) return { ...base, state: 'add' };

  const fields = fieldChanges(prior, live, format);
  return fields.length ? { ...base, state: 'mod', fields } : { ...base, state: 'same' };
}

/** Fields whose value the merge actually moves, `id` excluded. */
function fieldChanges(
  prior: object,
  live: object,
  format: (field: string, value: unknown) => string
): Transition[] {
  const before = prior as Record<string, unknown>;
  const after = live as Record<string, unknown>;
  // `after` first so the transitions read in the entity's own field order.
  const fields = new Set([...Object.keys(after), ...Object.keys(before)]);

  const out: Transition[] = [];
  for (const field of fields) {
    if (field === 'id') continue;
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    out.push({
      field,
      from: format(field, before[field]),
      to: format(field, after[field]),
    });
  }
  return out;
}

/**
 * The header count is taken from the marks actually rendered, so it can never
 * send someone hunting for a change that isn't shown.
 */
function counted(table: Omit<ResultTable, 'changes'>): ResultTable {
  const marked = rowsOf(table as ResultTable).filter((r) => r.state !== 'same').length;
  // A table created or dropped wholesale counts as a change in its own right.
  return { ...table, changes: marked + (table.renamedFrom ? 1 : 0) + (table.state ? 1 : 0) };
}
