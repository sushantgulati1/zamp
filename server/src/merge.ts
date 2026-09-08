import type { Table, Schema } from './types.js';

export type ConflictKind = 'table' | 'column' | 'index' | 'constraint';
export type ConflictReason = 'add-add' | 'edit-edit' | 'modify-delete';
export type Resolution = 'ours' | 'theirs' | 'keep' | 'delete';
export type ResolutionMap = Record<string, Resolution>;

export interface Conflict {
  id: string;
  kind: ConflictKind;
  reason: ConflictReason;
  tableId: string;
  entityId: string;
  /** Set on field conflicts; `base`/`ours`/`theirs` are then that field's values. */
  field?: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  /** modify-delete only. */
  deletedSide?: 'ours' | 'theirs';
}

/** Why a field ended up with the value it did — one row of the resolve table. */
export type FieldStatus =
  | { status: 'auto'; won: 'converged' | 'ours' | 'theirs' }
  | { status: 'conflict'; conflictId: string };

/**
 * Everything the resolve UI needs to render one card. Computed as if no
 * resolutions were supplied, so it is identical on every call within a merge
 * session: `entities` is the stable set of cards, `conflicts` the shrinking set
 * of what is still outstanding.
 */
export interface EntityContext {
  key: string;
  kind: ConflictKind;
  tableId: string;
  entityId: string;
  tableName: string;
  entityName: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  fields: Record<string, FieldStatus>;
}

/** `${tableId}:${entityId}:${field}` → the conflict id that decided that field. */
export type Provenance = Record<string, string>;

export interface MergeResult {
  schema: Schema;
  conflicts: Conflict[];
  entities: EntityContext[];
  provenance: Provenance;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((x) => [x.id, x]));
}

/** Entity-scoped id — modify-delete, which has no field to point at. */
function conflictId(kind: ConflictKind, tableId: string, entityId: string): string {
  return `${kind}:${tableId}:${entityId}`;
}

/** Field-scoped id. The card's identity is this minus the last segment. */
function fieldConflictId(
  kind: ConflictKind,
  tableId: string,
  entityId: string,
  field: string
): string {
  return `${kind}:${tableId}:${entityId}:${field}`;
}

/** Union of field names across whichever sides are present. `id` is identity, never merged. */
function fieldNames(sides: (Record<string, unknown> | undefined)[]): string[] {
  const fields = new Set<string>();
  for (const side of sides) {
    if (side) for (const k of Object.keys(side)) if (k !== 'id') fields.add(k);
  }
  return [...fields];
}

/**
 * Three-way merge of one entity's fields — the heart of field-level resolution.
 * A field only conflicts when both sides moved it to *different* values; a field
 * one side left alone takes the other side's value, so disjoint edits to the same
 * entity merge with no conflict at all.
 *
 * `hasBase` gates the "this side didn't change it" shortcuts: without an ancestor
 * that claim is meaningless, so an add-add auto-merges a field only on equality.
 */
function mergeFields<T extends { id: string }>(
  kind: ConflictKind,
  tableId: string,
  entityId: string,
  base: T | undefined,
  ours: T,
  theirs: T,
  resolutions: ResolutionMap
): { entity: T; conflicts: Conflict[]; statuses: Record<string, FieldStatus> } {
  const b = base as Record<string, unknown> | undefined;
  const o = ours as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  const hasBase = base !== undefined;

  const merged: Record<string, unknown> = { id: entityId };
  const conflicts: Conflict[] = [];
  const statuses: Record<string, FieldStatus> = {};

  for (const field of fieldNames([b, o, t])) {
    if (deepEqual(o[field], t[field])) {
      assign(merged, field, o[field]);
      statuses[field] = { status: 'auto', won: 'converged' };
      continue;
    }
    if (hasBase && deepEqual(b![field], o[field])) {
      assign(merged, field, t[field]);
      statuses[field] = { status: 'auto', won: 'theirs' };
      continue;
    }
    if (hasBase && deepEqual(b![field], t[field])) {
      assign(merged, field, o[field]);
      statuses[field] = { status: 'auto', won: 'ours' };
      continue;
    }

    const cid = fieldConflictId(kind, tableId, entityId, field);
    const resolution = resolutions[cid];
    if (!resolution) {
      conflicts.push({
        id: cid,
        kind,
        reason: hasBase ? 'edit-edit' : 'add-add',
        tableId,
        entityId,
        field,
        base: b?.[field],
        ours: o[field],
        theirs: t[field],
      });
    }
    // Provisional 'ours' while unresolved, so the merged schema stays renderable.
    assign(merged, field, resolution === 'theirs' ? t[field] : o[field]);
    statuses[field] = { status: 'conflict', conflictId: cid };
  }

  return { entity: merged as unknown as T, conflicts, statuses };
}

/** Keep absent optional fields absent rather than writing an explicit `undefined`. */
function assign(target: Record<string, unknown>, field: string, value: unknown): void {
  if (value !== undefined) target[field] = value;
}

/** Accumulates the resolution-independent view of the merge as it runs. */
interface Collector {
  entities: EntityContext[];
  provenance: Provenance;
}

function record(
  collect: Collector,
  context: Omit<EntityContext, 'key' | 'fields'>,
  statuses: Record<string, FieldStatus>
): void {
  const conflicted = Object.values(statuses).some((s) => s.status === 'conflict');
  if (!conflicted && Object.keys(statuses).length > 0) return;

  collect.entities.push({
    key: conflictId(context.kind, context.tableId, context.entityId),
    ...context,
    fields: statuses,
  });
  for (const [field, status] of Object.entries(statuses)) {
    if (status.status === 'conflict') {
      collect.provenance[`${context.tableId}:${context.entityId}:${field}`] = status.conflictId;
    }
  }
}

function nameOf(...sides: (unknown | undefined)[]): string {
  for (const side of sides) {
    if (side && typeof side === 'object' && typeof (side as any).name === 'string') {
      return (side as any).name;
    }
  }
  return '';
}

/**
 * Generic 3-way merge for a flat, id-keyed entity collection (columns, indexes,
 * constraints). Presence is decided here; whenever both sides still have the
 * entity, the actual comparison drops to `mergeFields`.
 */
function mergeEntitySet<T extends { id: string }>(
  kind: ConflictKind,
  tableId: string,
  tableName: string,
  base: T[],
  ours: T[],
  theirs: T[],
  resolutions: ResolutionMap,
  collect: Collector
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

    if (o && t) {
      const merged = mergeFields(kind, tableId, id, b, o, t, resolutions);
      items.push(merged.entity);
      conflicts.push(...merged.conflicts);
      record(
        collect,
        {
          kind, tableId, entityId: id, tableName, entityName: nameOf(o, t, b),
          base: b, ours: o, theirs: t,
        },
        merged.statuses
      );
      continue;
    }

    if (!b) {
      // Added on exactly one side — nothing to disagree with.
      if (o) items.push(o);
      else if (t) items.push(t);
      continue;
    }
    if (!o && !t) continue; // removed on both sides

    // Present in base and exactly one side: a delete, possibly contested.
    const survivor = (o ?? t)!;
    const deletedSide: 'ours' | 'theirs' = o ? 'theirs' : 'ours';
    if (deepEqual(survivor, b)) continue; // the surviving side never touched it; the delete wins

    const cid = conflictId(kind, tableId, id);
    const resolution = resolutions[cid];
    if (!resolution) {
      conflicts.push({
        id: cid, kind, reason: 'modify-delete', tableId, entityId: id, deletedSide,
        base: b, ours: o, theirs: t,
      });
    }
    record(
      collect,
      {
        kind, tableId, entityId: id, tableName, entityName: nameOf(survivor, b),
        base: b, ours: o, theirs: t,
      },
      {}
    );
    // Provisional: keep the edited version until the delete is confirmed.
    if (resolution !== 'delete') items.push(survivor);
  }

  return { items, conflicts };
}

/** The table's own scalar fields. Its children are merged separately. */
type TableHead = { id: string; name: string };

function head(table: Table): TableHead;
function head(table: Table | undefined): TableHead | undefined;
function head(table: Table | undefined): TableHead | undefined {
  return table ? { id: table.id, name: table.name } : undefined;
}

function mergeTable(
  id: string,
  base: Table | undefined,
  ours: Table | undefined,
  theirs: Table | undefined,
  resolutions: ResolutionMap,
  collect: Collector
): { table?: Table; conflicts: Conflict[] } {
  if (ours && theirs) {
    const name = mergeFields('table', id, id, head(base), head(ours), head(theirs), resolutions);
    const tableName = name.entity.name;
    const conflicts = [...name.conflicts];
    record(
      collect,
      {
        kind: 'table', tableId: id, entityId: id, tableName, entityName: tableName,
        base: head(base), ours: head(ours), theirs: head(theirs),
      },
      name.statuses
    );

    const args = [id, tableName, resolutions, collect] as const;
    const columns = mergeEntitySet('column', args[0], args[1], base?.columns ?? [], ours.columns, theirs.columns, args[2], args[3]);
    const indexes = mergeEntitySet('index', args[0], args[1], base?.indexes ?? [], ours.indexes, theirs.indexes, args[2], args[3]);
    const constraints = mergeEntitySet('constraint', args[0], args[1], base?.constraints ?? [], ours.constraints, theirs.constraints, args[2], args[3]);
    conflicts.push(...columns.conflicts, ...indexes.conflicts, ...constraints.conflicts);

    return {
      table: { id, name: tableName, columns: columns.items, indexes: indexes.items, constraints: constraints.items },
      conflicts,
    };
  }

  if (!base) {
    // Created on exactly one side.
    return { table: ours ?? theirs, conflicts: [] };
  }
  if (!ours && !theirs) return { conflicts: [] }; // dropped on both sides

  const survivor = (ours ?? theirs)!;
  const deletedSide: 'ours' | 'theirs' = ours ? 'theirs' : 'ours';
  if (deepEqual(survivor, base)) return { conflicts: [] }; // the delete wins uncontested

  const cid = conflictId('table', id, id);
  const resolution = resolutions[cid];
  const conflicts: Conflict[] = [];
  if (!resolution) {
    conflicts.push({
      id: cid, kind: 'table', reason: 'modify-delete', tableId: id, entityId: id, deletedSide,
      base, ours, theirs,
    });
  }
  record(
    collect,
    {
      kind: 'table', tableId: id, entityId: id, tableName: survivor.name, entityName: survivor.name,
      base, ours, theirs,
    },
    {}
  );
  return { table: resolution === 'delete' ? undefined : survivor, conflicts };
}

export function merge3(
  base: Schema,
  ours: Schema,
  theirs: Schema,
  resolutions: ResolutionMap = {}
): MergeResult {
  const baseMap = mapById(base.tables);
  const oursMap = mapById(ours.tables);
  const theirsMap = mapById(theirs.tables);
  const allIds = new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);

  const tables: Table[] = [];
  const conflicts: Conflict[] = [];
  const collect: Collector = { entities: [], provenance: {} };

  for (const id of allIds) {
    const { table, conflicts: c } = mergeTable(
      id, baseMap.get(id), oursMap.get(id), theirsMap.get(id), resolutions, collect
    );
    conflicts.push(...c);
    if (table) tables.push(table);
  }

  return { schema: { tables }, conflicts, entities: collect.entities, provenance: collect.provenance };
}
