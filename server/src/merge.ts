import type { Table, Schema } from './types.js';

export type ConflictKind = 'table' | 'table-name' | 'column' | 'index' | 'constraint';
export type ConflictReason = 'add-add' | 'edit-edit' | 'modify-delete';
export type Resolution = 'ours' | 'theirs' | 'keep' | 'delete';
export type ResolutionMap = Record<string, Resolution>;

export interface Conflict {
  id: string;
  kind: ConflictKind;
  reason: ConflictReason;
  tableId: string;
  entityId: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  deletedSide?: 'ours' | 'theirs';
  fieldsDiffering?: string[];
}

export interface MergeResult {
  schema: Schema;
  conflicts: Conflict[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((x) => [x.id, x]));
}

function conflictId(kind: ConflictKind, tableId: string, entityId: string): string {
  return `${kind}:${tableId}:${entityId}`;
}

function fieldsDiffering(base: unknown, ours: unknown, theirs: unknown): string[] {
  const objs = [base, ours, theirs].filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object'
  );
  const fields = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) fields.add(k);
  const differing: string[] = [];
  for (const f of fields) {
    const values = [base, ours, theirs].map((o) => (o && typeof o === 'object' ? (o as any)[f] : undefined));
    if (!(deepEqual(values[0], values[1]) && deepEqual(values[1], values[2]))) {
      differing.push(f);
    }
  }
  return differing;
}

/**
 * Generic 3-way merge for a flat, id-keyed entity collection (columns, indexes, constraints).
 * Mirrors LOW_LEVEL_DESIGN.md §4.4.
 */
function mergeEntitySet<T extends { id: string }>(
  kind: ConflictKind,
  tableId: string,
  base: T[],
  ours: T[],
  theirs: T[],
  resolutions: ResolutionMap
): { items: T[]; conflicts: Conflict[] } {
  const baseMap = mapById(base);
  const oursMap = mapById(ours);
  const theirsMap = mapById(theirs);
  const allIds = new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);

  const items: T[] = [];
  const conflicts: Conflict[] = [];

  for (const id of allIds) {
    const b = baseMap.get(id);
    const o = oursMap.get(id);
    const t = theirsMap.get(id);
    const cid = conflictId(kind, tableId, id);
    const resolution = resolutions[cid];

    if (!b && o && !t) {
      items.push(o);
      continue;
    }
    if (!b && !o && t) {
      items.push(t);
      continue;
    }
    if (!b && o && t) {
      if (deepEqual(o, t)) {
        items.push(o);
        continue;
      }
      if (!resolution) {
        conflicts.push({
          id: cid, kind, reason: 'add-add', tableId, entityId: id,
          ours: o, theirs: t, fieldsDiffering: fieldsDiffering(undefined, o, t),
        });
      }
      items.push(resolution === 'theirs' ? t : o); // provisional default 'ours' while unresolved
      continue;
    }
    if (b && !o && !t) continue; // removed on both sides
    if (b && !o && t) {
      if (deepEqual(t, b)) continue; // ours' removal wins, theirs never touched it
      if (!resolution) {
        conflicts.push({ id: cid, kind, reason: 'modify-delete', tableId, entityId: id, deletedSide: 'ours', base: b, theirs: t });
      }
      if (resolution !== 'delete') items.push(t); // provisional: keep the edited version until resolved
      continue;
    }
    if (b && o && !t) {
      if (deepEqual(o, b)) continue; // theirs' removal wins
      if (!resolution) {
        conflicts.push({ id: cid, kind, reason: 'modify-delete', tableId, entityId: id, deletedSide: 'theirs', base: b, ours: o });
      }
      if (resolution !== 'delete') items.push(o); // provisional: keep the edited version until resolved
      continue;
    }
    if (b && o && t) {
      if (deepEqual(o, t)) {
        items.push(o);
        continue;
      }
      if (deepEqual(b, o)) {
        items.push(t); // only theirs changed
        continue;
      }
      if (deepEqual(b, t)) {
        items.push(o); // only ours changed
        continue;
      }
      if (!resolution) {
        conflicts.push({
          id: cid, kind, reason: 'edit-edit', tableId, entityId: id,
          base: b, ours: o, theirs: t, fieldsDiffering: fieldsDiffering(b, o, t),
        });
      }
      items.push(resolution === 'theirs' ? t : o); // provisional default 'ours' while unresolved
      continue;
    }
  }

  return { items, conflicts };
}

function mergeTable(
  id: string,
  base: Table | undefined,
  ours: Table | undefined,
  theirs: Table | undefined,
  resolutions: ResolutionMap
): { table?: Table; conflicts: Conflict[] } {
  const cid = conflictId('table', id, id);
  const resolution = resolutions[cid];

  if (!base && ours && !theirs) return { table: ours, conflicts: [] };
  if (!base && !ours && theirs) return { table: theirs, conflicts: [] };
  if (!base && ours && theirs) {
    if (deepEqual(ours, theirs)) return { table: ours, conflicts: [] };
    const table = resolution === 'theirs' ? theirs : ours;
    if (resolution) return { table, conflicts: [] };
    const conflict: Conflict = { id: cid, kind: 'table', reason: 'add-add', tableId: id, entityId: id, ours, theirs };
    return { table, conflicts: [conflict] };
  }
  if (base && !ours && !theirs) return { conflicts: [] }; // removed both sides
  if (base && !ours && theirs) {
    if (deepEqual(theirs, base)) return { conflicts: [] }; // ours' removal wins
    const table = resolution === 'delete' ? undefined : theirs;
    if (resolution) return { table, conflicts: [] };
    const conflict: Conflict = {
      id: cid, kind: 'table', reason: 'modify-delete', tableId: id, entityId: id, deletedSide: 'ours', base, theirs,
    };
    return { table, conflicts: [conflict] };
  }
  if (base && ours && !theirs) {
    if (deepEqual(ours, base)) return { conflicts: [] }; // theirs' removal wins
    const table = resolution === 'delete' ? undefined : ours;
    if (resolution) return { table, conflicts: [] };
    const conflict: Conflict = {
      id: cid, kind: 'table', reason: 'modify-delete', tableId: id, entityId: id, deletedSide: 'theirs', base, ours,
    };
    return { table, conflicts: [conflict] };
  }

  // present in all three: recurse into name + columns/indexes/constraints
  const conflicts: Conflict[] = [];
  let name = ours!.name;
  if (base!.name !== ours!.name && base!.name === theirs!.name) {
    name = ours!.name; // only ours changed
  } else if (base!.name === ours!.name && base!.name !== theirs!.name) {
    name = theirs!.name; // only theirs changed
  } else if (ours!.name !== theirs!.name && base!.name !== ours!.name && base!.name !== theirs!.name) {
    const nameConflictId = conflictId('table-name', id, id);
    const nameResolution = resolutions[nameConflictId];
    if (!nameResolution) {
      conflicts.push({
        id: nameConflictId, kind: 'table-name', reason: 'edit-edit', tableId: id, entityId: id,
        base: base!.name, ours: ours!.name, theirs: theirs!.name, fieldsDiffering: ['name'],
      });
    }
    name = nameResolution === 'theirs' ? theirs!.name : ours!.name;
  }

  const columns = mergeEntitySet('column', id, base!.columns, ours!.columns, theirs!.columns, resolutions);
  const indexes = mergeEntitySet('index', id, base!.indexes, ours!.indexes, theirs!.indexes, resolutions);
  const constraints = mergeEntitySet('constraint', id, base!.constraints, ours!.constraints, theirs!.constraints, resolutions);
  conflicts.push(...columns.conflicts, ...indexes.conflicts, ...constraints.conflicts);

  return {
    table: { id, name, columns: columns.items, indexes: indexes.items, constraints: constraints.items },
    conflicts,
  };
}

export function merge3(base: Schema, ours: Schema, theirs: Schema, resolutions: ResolutionMap = {}): MergeResult {
  const baseMap = mapById(base.tables);
  const oursMap = mapById(ours.tables);
  const theirsMap = mapById(theirs.tables);
  const allIds = new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);

  const tables: Table[] = [];
  const conflicts: Conflict[] = [];

  for (const id of allIds) {
    const { table, conflicts: c } = mergeTable(id, baseMap.get(id), oursMap.get(id), theirsMap.get(id), resolutions);
    conflicts.push(...c);
    if (table) tables.push(table);
  }

  return { schema: { tables }, conflicts };
}
