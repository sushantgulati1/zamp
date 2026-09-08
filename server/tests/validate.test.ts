import { describe, it, expect } from 'vitest';
import { validate } from '../src/validate.js';
import type { Schema, Table, Column, IndexDef, ConstraintDef } from '../src/types.js';

function col(overrides: Partial<Column> = {}): Column {
  return { id: 'c1', name: 'email', type: 'text', nullable: true, primaryKey: false, ...overrides };
}

function idx(overrides: Partial<IndexDef> = {}): IndexDef {
  return { id: 'i1', name: 'idx_email', columnIds: ['c1'], unique: false, ...overrides };
}

function con(overrides: Partial<ConstraintDef> = {}): ConstraintDef {
  return { id: 'k1', name: 'ck_email', type: 'check', definition: "email <> ''", ...overrides };
}

function table(overrides: Partial<Table> = {}): Table {
  return { id: 't1', name: 'users', columns: [], indexes: [], constraints: [], ...overrides };
}

const codes = (s: Schema) => validate(s, {}).map((v) => v.code);

describe('validate', () => {
  it('passes a schema that breaks nothing', () => {
    expect(validate({ tables: [table({ columns: [col()], indexes: [idx()] })] }, {})).toEqual([]);
  });

  it('rejects two tables sharing a name', () => {
    const schema: Schema = { tables: [table(), table({ id: 't2' })] };
    const violations = validate(schema, {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: 'duplicate-table-name', tableId: 't1' });
    expect(violations[0].message).toContain('users');
  });

  it('rejects two columns sharing a name within a table', () => {
    const schema: Schema = { tables: [table({ columns: [col(), col({ id: 'c2' })] })] };
    expect(codes(schema)).toEqual(['duplicate-column-name']);
  });

  it('allows the same column name in two different tables', () => {
    const schema: Schema = {
      tables: [table({ columns: [col()] }), table({ id: 't2', name: 'orders', columns: [col()] })],
    };
    expect(validate(schema, {})).toEqual([]);
  });

  it('rejects two indexes sharing a name within a table', () => {
    const schema: Schema = { tables: [table({ columns: [col()], indexes: [idx(), idx({ id: 'i2' })] })] };
    expect(codes(schema)).toEqual(['duplicate-index-name']);
  });

  it('rejects two constraints sharing a name within a table', () => {
    const schema: Schema = { tables: [table({ constraints: [con(), con({ id: 'k2' })] })] };
    expect(codes(schema)).toEqual(['duplicate-constraint-name']);
  });

  it('rejects an empty name on any entity', () => {
    expect(codes({ tables: [table({ name: '  ' })] })).toEqual(['empty-name']);
    expect(codes({ tables: [table({ columns: [col({ name: '' })] })] })).toEqual(['empty-name']);
    expect(codes({ tables: [table({ columns: [col()], indexes: [idx({ name: '' })] })] })).toEqual(['empty-name']);
    expect(codes({ tables: [table({ constraints: [con({ name: '' })] })] })).toEqual(['empty-name']);
  });

  it('rejects a column with no type', () => {
    expect(codes({ tables: [table({ columns: [col({ type: ' ' })] })] })).toEqual(['empty-type']);
  });

  it('rejects a constraint with no definition', () => {
    expect(codes({ tables: [table({ constraints: [con({ definition: '' })] })] })).toEqual(['empty-definition']);
  });

  it('rejects an index covering no columns', () => {
    expect(codes({ tables: [table({ indexes: [idx({ columnIds: [] })] })] })).toEqual(['index-no-columns']);
  });

  it('rejects an index left pointing at a column the merge dropped', () => {
    const schema: Schema = { tables: [table({ columns: [], indexes: [idx({ columnIds: ['c1'] })] })] };
    const violations = validate(schema, {});
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: 'dangling-column-ref', tableId: 't1', entityId: 'i1' });
  });

  it('rejects a constraint left pointing at a column the merge dropped', () => {
    const schema: Schema = { tables: [table({ columns: [], constraints: [con({ columnIds: ['c1'] })] })] };
    expect(codes(schema)).toEqual(['dangling-column-ref']);
  });

  // The schema editor lets you do this on one branch with no merge involved
  // (operations.ts setColumnPrimaryKey), so a merge must not block on it.
  it('allows a nullable primary key, because the editor does', () => {
    const schema: Schema = { tables: [table({ columns: [col({ primaryKey: true, nullable: true })] })] };
    expect(validate(schema, {})).toEqual([]);
  });

  it('links a violation back to the picks that produced it', () => {
    const schema: Schema = { tables: [table(), table({ id: 't2' })] };
    const provenance = { 't1:t1:name': 'table:t1:t1:name' };
    expect(validate(schema, provenance)[0].conflictIds).toEqual(['table:t1:t1:name']);
  });

  it('anchors a table-name collision on the colliding tables, not the first table', () => {
    const schema: Schema = {
      tables: [table({ id: 't1', name: 'users' }), table({ id: 't2', name: 'orders' }), table({ id: 't3', name: 'orders' })],
    };
    const provenance = { 't3:t3:name': 'table:t3:t3:name' };
    const violations = validate(schema, provenance);
    expect(violations).toHaveLength(1);
    expect(violations[0].tableId).toBe('t2');
    expect(violations[0].conflictIds).toEqual(['table:t3:t3:name']);
  });

  it('leaves conflictIds empty when no pick can fix the violation', () => {
    const schema: Schema = { tables: [table(), table({ id: 't2' })] };
    expect(validate(schema, {})[0].conflictIds).toEqual([]);
  });
});
