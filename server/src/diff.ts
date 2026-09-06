import type { Table, Column, IndexDef, ConstraintDef, Schema } from './types.js';

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export interface EntityDiff<T> {
  added: T[];
  removed: T[];
  modified: { id: string; before: T; after: T; fields: FieldDiff[] }[];
}

export interface TableDiff {
  id: string;
  name?: { from: string; to: string };
  columns: EntityDiff<Column>;
  indexes: EntityDiff<IndexDef>;
  constraints: EntityDiff<ConstraintDef>;
}

export interface SchemaDiff {
  tablesAdded: Table[];
  tablesRemoved: Table[];
  tablesChanged: TableDiff[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function fieldDiff<T extends Record<string, unknown>>(before: T, after: T): FieldDiff[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    if (!deepEqual(before[field], after[field])) {
      diffs.push({ field, from: before[field], to: after[field] });
    }
  }
  return diffs;
}

export function diffCollection<T extends { id: string }>(before: T[], after: T[]): EntityDiff<T> {
  const beforeMap = new Map(before.map((x) => [x.id, x]));
  const afterMap = new Map(after.map((x) => [x.id, x]));
  const added = after.filter((a) => !beforeMap.has(a.id));
  const removed = before.filter((b) => !afterMap.has(b.id));
  const modified: EntityDiff<T>['modified'] = [];
  for (const [id, before_] of beforeMap) {
    const after_ = afterMap.get(id);
    if (after_ && !deepEqual(after_, before_)) {
      modified.push({ id, before: before_, after: after_, fields: fieldDiff(before_ as any, after_ as any) });
    }
  }
  return { added, removed, modified };
}

function hasChanges<T>(d: EntityDiff<T>): boolean {
  return d.added.length > 0 || d.removed.length > 0 || d.modified.length > 0;
}

export function diffSchemas(before: Schema, after: Schema): SchemaDiff {
  const beforeMap = new Map(before.tables.map((t) => [t.id, t]));
  const afterMap = new Map(after.tables.map((t) => [t.id, t]));

  const tablesAdded = after.tables.filter((t) => !beforeMap.has(t.id));
  const tablesRemoved = before.tables.filter((t) => !afterMap.has(t.id));
  const tablesChanged: TableDiff[] = [];

  for (const [id, b] of beforeMap) {
    const a = afterMap.get(id);
    if (!a) continue;
    const columns = diffCollection(b.columns, a.columns);
    const indexes = diffCollection(b.indexes, a.indexes);
    const constraints = diffCollection(b.constraints, a.constraints);
    const nameChanged = b.name !== a.name;
    if (nameChanged || hasChanges(columns) || hasChanges(indexes) || hasChanges(constraints)) {
      tablesChanged.push({
        id,
        name: nameChanged ? { from: b.name, to: a.name } : undefined,
        columns,
        indexes,
        constraints,
      });
    }
  }

  return { tablesAdded, tablesRemoved, tablesChanged };
}
