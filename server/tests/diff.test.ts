import { describe, it, expect } from 'vitest';
import { diffSchemas } from '../src/diff.js';
import type { Schema, Table } from '../src/types.js';

function makeTable(overrides: Partial<Table> = {}): Table {
  return { id: 't1', name: 'users', columns: [], indexes: [], constraints: [], ...overrides };
}

describe('diffSchemas', () => {
  it('reports no changes for identical schemas', () => {
    const schema: Schema = { tables: [makeTable()] };
    const diff = diffSchemas(schema, schema);
    expect(diff.tablesAdded).toEqual([]);
    expect(diff.tablesRemoved).toEqual([]);
    expect(diff.tablesChanged).toEqual([]);
  });

  it('detects an added table', () => {
    const before: Schema = { tables: [] };
    const after: Schema = { tables: [makeTable()] };
    const diff = diffSchemas(before, after);
    expect(diff.tablesAdded).toHaveLength(1);
    expect(diff.tablesAdded[0].id).toBe('t1');
  });

  it('detects a removed table', () => {
    const before: Schema = { tables: [makeTable()] };
    const after: Schema = { tables: [] };
    const diff = diffSchemas(before, after);
    expect(diff.tablesRemoved).toHaveLength(1);
    expect(diff.tablesRemoved[0].id).toBe('t1');
  });

  it('detects an added column within an existing table', () => {
    const before: Schema = { tables: [makeTable()] };
    const after: Schema = {
      tables: [makeTable({ columns: [{ id: 'c1', name: 'email', type: 'text', nullable: true, primaryKey: false }] })],
    };
    const diff = diffSchemas(before, after);
    expect(diff.tablesChanged).toHaveLength(1);
    expect(diff.tablesChanged[0].columns.added).toHaveLength(1);
    expect(diff.tablesChanged[0].columns.added[0].id).toBe('c1');
  });

  it('distinguishes a rename from a drop+add of an unrelated column', () => {
    const before: Schema = {
      tables: [makeTable({ columns: [{ id: 'c1', name: 'email', type: 'text', nullable: true, primaryKey: false }] })],
    };
    const renamed: Schema = {
      tables: [
        makeTable({ columns: [{ id: 'c1', name: 'email_address', type: 'text', nullable: true, primaryKey: false }] }),
      ],
    };
    const renameDiff = diffSchemas(before, renamed);
    expect(renameDiff.tablesChanged[0].columns.added).toEqual([]);
    expect(renameDiff.tablesChanged[0].columns.removed).toEqual([]);
    expect(renameDiff.tablesChanged[0].columns.modified).toHaveLength(1);
    expect(renameDiff.tablesChanged[0].columns.modified[0].fields).toEqual([
      { field: 'name', from: 'email', to: 'email_address' },
    ]);

    const dropAndAdd: Schema = {
      tables: [
        makeTable({ columns: [{ id: 'c2', name: 'email_address', type: 'text', nullable: true, primaryKey: false }] }),
      ],
    };
    const dropAddDiff = diffSchemas(before, dropAndAdd);
    expect(dropAddDiff.tablesChanged[0].columns.removed).toHaveLength(1);
    expect(dropAddDiff.tablesChanged[0].columns.added).toHaveLength(1);
    expect(dropAddDiff.tablesChanged[0].columns.modified).toEqual([]);
  });

  it('detects a retype as a field-level modification', () => {
    const before: Schema = {
      tables: [makeTable({ columns: [{ id: 'c1', name: 'age', type: 'integer', nullable: true, primaryKey: false }] })],
    };
    const after: Schema = {
      tables: [
        makeTable({
          columns: [{ id: 'c1', name: 'age', type: 'numeric', length: 10, nullable: true, primaryKey: false }],
        }),
      ],
    };
    const diff = diffSchemas(before, after);
    const modified = diff.tablesChanged[0].columns.modified[0];
    expect(modified.fields).toEqual(
      expect.arrayContaining([
        { field: 'type', from: 'integer', to: 'numeric' },
        { field: 'length', from: undefined, to: 10 },
      ])
    );
  });
});
