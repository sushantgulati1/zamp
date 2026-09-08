import { describe, it, expect } from 'vitest';
import { merge3 } from '../src/merge.js';
import type { Schema, Table, Column } from '../src/types.js';

function col(overrides: Partial<Column> = {}): Column {
  return { id: 'c1', name: 'email', type: 'text', nullable: true, primaryKey: false, ...overrides };
}

function table(overrides: Partial<Table> = {}): Table {
  return { id: 't1', name: 'users', columns: [], indexes: [], constraints: [], ...overrides };
}

describe('merge3', () => {
  it('merges non-overlapping column additions with zero conflicts', () => {
    const base: Schema = { tables: [table()] };
    const ours: Schema = { tables: [table({ columns: [col({ id: 'c1', name: 'email' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ id: 'c2', name: 'phone' })] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('takes the only side that changed a field, when the other left it untouched', () => {
    const base: Schema = { tables: [table({ columns: [col()] })] };
    const ours: Schema = { tables: [table({ columns: [col()] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'varchar' })] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns[0].type).toBe('varchar');
  });

  it('applies a clean drop when only one side removed the entity', () => {
    const base: Schema = { tables: [table({ columns: [col()] })] };
    const ours: Schema = { tables: [table({ columns: [] })] };
    const theirs: Schema = { tables: [table({ columns: [col()] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns).toEqual([]);
  });

  it('merges an index addition alongside a column addition with zero conflicts', () => {
    const base: Schema = { tables: [table({ columns: [col()] })] };
    const ours: Schema = { tables: [table({ columns: [col(), col({ id: 'c2', name: 'phone' })] })] };
    const theirs: Schema = {
      tables: [
        table({ columns: [col()], indexes: [{ id: 'i1', name: 'idx_email', columnIds: ['c1'], unique: true }] }),
      ],
    };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(schema.tables[0].indexes.map((i) => i.id)).toEqual(['i1']);
  });

  it('auto-merges disjoint field edits to the same column', () => {
    const base: Schema = { tables: [table({ columns: [col({ name: 'email', type: 'varchar' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ name: 'email_address', type: 'varchar' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ name: 'email', type: 'text' })] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns[0]).toMatchObject({ name: 'email_address', type: 'text' });
  });

  it('scopes an edit-edit conflict to the one field both sides changed', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'column:t1:c1:type',
      kind: 'column',
      reason: 'edit-edit',
      tableId: 't1',
      entityId: 'c1',
      field: 'type',
      base: 'integer',
      ours: 'numeric',
      theirs: 'bigint',
    });
  });

  it('conflicts only on the contested field, auto-merging its siblings', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer', nullable: true })] })] };
    const ours: Schema = {
      tables: [table({ columns: [col({ name: 'age', type: 'numeric', nullable: true })] })],
    };
    const theirs: Schema = {
      tables: [table({ columns: [col({ type: 'bigint', nullable: false })] })],
    };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts.map((c) => c.field)).toEqual(['type']);
    expect(schema.tables[0].columns[0]).toMatchObject({ name: 'age', nullable: false });
  });

  it('resolves a field conflict once a resolution is supplied', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    const resolved = merge3(base, ours, theirs, { 'column:t1:c1:type': 'theirs' });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.schema.tables[0].columns[0].type).toBe('bigint');
  });

  it('resolves two conflicting fields on one entity independently', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer', default: 'a' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric', default: 'b' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint', default: 'c' })] })] };

    const half = merge3(base, ours, theirs, { 'column:t1:c1:type': 'theirs' });
    expect(half.conflicts.map((c) => c.field)).toEqual(['default']);
    expect(half.schema.tables[0].columns[0].type).toBe('bigint');

    const full = merge3(base, ours, theirs, {
      'column:t1:c1:type': 'theirs',
      'column:t1:c1:default': 'ours',
    });
    expect(full.conflicts).toEqual([]);
    expect(full.schema.tables[0].columns[0]).toMatchObject({ type: 'bigint', default: 'b' });
  });

  it('does not conflict when both sides make the identical edit', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns[0].type).toBe('numeric');
  });

  it('raises a modify-delete conflict when one side drops what the other modified', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'column', reason: 'modify-delete', deletedSide: 'ours' });
  });

  it('honors both modify-delete resolutions: delete removes it, keep restores the edited version', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };

    const deleted = merge3(base, ours, theirs, { 'column:t1:c1': 'delete' });
    expect(deleted.conflicts).toEqual([]);
    expect(deleted.schema.tables[0].columns).toEqual([]);

    const kept = merge3(base, ours, theirs, { 'column:t1:c1': 'keep' });
    expect(kept.conflicts).toEqual([]);
    expect(kept.schema.tables[0].columns[0].type).toBe('numeric');
  });

  it('raises a modify-delete conflict at whole-table granularity', () => {
    const base: Schema = { tables: [table()] };
    const ours: Schema = { tables: [] };
    const theirs: Schema = { tables: [table({ name: 'accounts' })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'table', reason: 'modify-delete', deletedSide: 'ours', tableId: 't1' });
  });

  it('merges two independently created tables with zero conflicts', () => {
    const base: Schema = { tables: [] };
    const ours: Schema = { tables: [table({ id: 't1', name: 'users' })] };
    const theirs: Schema = { tables: [table({ id: 't2', name: 'orders' })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('takes an optional field one side added while the other left it absent', () => {
    const base: Schema = { tables: [table({ columns: [col()] })] };
    const ours: Schema = { tables: [table({ columns: [col({ default: 'now()' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col()] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(schema.tables[0].columns[0].default).toBe('now()');
  });

  it('drops an optional field entirely when one side cleared it and the other left it', () => {
    const base: Schema = { tables: [table({ columns: [col({ default: 'a' })] })] };
    const ours: Schema = { tables: [table({ columns: [col()] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ default: 'a' })] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toEqual([]);
    // Absent, not present-and-undefined — the merged entity is fed straight into a commit.
    expect('default' in schema.tables[0].columns[0]).toBe(false);
  });

  it('conflicts when one side removes an optional field the other changed', () => {
    const base: Schema = { tables: [table({ columns: [col({ default: 'a' })] })] };
    const ours: Schema = { tables: [table({ columns: [col()] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ default: 'b' })] })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ field: 'default', base: 'a', ours: undefined, theirs: 'b' });
  });

  it('requires exact equality per field for an add-add, having no ancestor to arbitrate', () => {
    const base: Schema = { tables: [table()] };
    const ours: Schema = { tables: [table({ columns: [col()] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ default: 'x' })] })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ reason: 'add-add', field: 'default', base: undefined });
  });

  it('treats a table rename clash as a field conflict on the table', () => {
    const base: Schema = { tables: [table({ name: 'users' })] };
    const ours: Schema = { tables: [table({ name: 'accounts' })] };
    const theirs: Schema = { tables: [table({ name: 'people' })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'table:t1:t1:name',
      kind: 'table',
      field: 'name',
      ours: 'accounts',
      theirs: 'people',
    });
  });

  it('treats an index column list as one atomic field', () => {
    const idx = (columnIds: string[]) => ({ id: 'i1', name: 'idx', columnIds, unique: false });
    const base: Schema = { tables: [table({ indexes: [idx(['c1'])] })] };
    const ours: Schema = { tables: [table({ indexes: [idx(['c1', 'c2'])] })] };
    const theirs: Schema = { tables: [table({ indexes: [idx(['c2', 'c1'])] })] };
    const { schema, conflicts } = merge3(base, ours, theirs);
    expect(conflicts.map((c) => c.field)).toEqual(['columnIds']);

    const resolved = merge3(base, ours, theirs, { 'index:t1:i1:columnIds': 'theirs' });
    expect(resolved.schema.tables[0].indexes[0].columnIds).toEqual(['c2', 'c1']);
    expect(schema.tables[0].indexes[0].columnIds).toEqual(['c1', 'c2']);
  });
});

describe('merge3 entity context', () => {
  it('reports auto-merged fields alongside the contested one', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ name: 'age', type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint', nullable: false })] })] };
    const { entities } = merge3(base, ours, theirs);

    const column = entities.find((e) => e.key === 'column:t1:c1')!;
    expect(column).toMatchObject({ kind: 'column', tableName: 'users', entityName: 'age' });
    expect(column.fields).toMatchObject({
      name: { status: 'auto', won: 'ours' },
      type: { status: 'conflict', conflictId: 'column:t1:c1:type' },
      nullable: { status: 'auto', won: 'theirs' },
      primaryKey: { status: 'auto', won: 'converged' },
    });
  });

  it('stays identical once a conflict is resolved, so a decided row stays on screen', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };

    const before = merge3(base, ours, theirs);
    const after = merge3(base, ours, theirs, { 'column:t1:c1:type': 'theirs' });
    expect(after.conflicts).toEqual([]);
    expect(after.entities).toEqual(before.entities);
  });

  it('omits entities that merged without any conflict', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ name: 'age', type: 'integer' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    expect(merge3(base, ours, theirs).entities).toEqual([]);
  });

  it('includes a modify-delete as a card with no field rows', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const { entities } = merge3(base, ours, theirs);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ key: 'column:t1:c1', entityName: 'email', fields: {} });
  });

  it('maps each contested field back to the conflict that decided it', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    expect(merge3(base, ours, theirs).provenance).toEqual({
      't1:c1:type': 'column:t1:c1:type',
    });
  });
});
