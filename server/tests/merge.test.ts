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

  it('raises an edit-edit conflict when both sides retype the same column differently', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    const { conflicts } = merge3(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'column', reason: 'edit-edit', tableId: 't1', entityId: 'c1' });
    expect(conflicts[0].fieldsDiffering).toContain('type');
  });

  it('resolves an edit-edit conflict once a resolution is supplied', () => {
    const base: Schema = { tables: [table({ columns: [col({ type: 'integer' })] })] };
    const ours: Schema = { tables: [table({ columns: [col({ type: 'numeric' })] })] };
    const theirs: Schema = { tables: [table({ columns: [col({ type: 'bigint' })] })] };
    const resolved = merge3(base, ours, theirs, { 'column:t1:c1': 'theirs' });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.schema.tables[0].columns[0].type).toBe('bigint');
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
});
