import { useState } from 'react';
import type { Schema } from '../lib/types';
import { TableCard, type OpDispatch } from './TableCard';

export function SchemaEditor({
  schema,
  branch,
  onOp,
}: {
  schema: Schema;
  branch: string;
  onOp: OpDispatch;
}) {
  const [newTable, setNewTable] = useState('');

  const addTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.trim()) return;
    onOp('createTable', { name: newTable.trim() });
    setNewTable('');
  };

  return (
    <div className="content-inner">
      <div className="view-head">
        <div>
          <span className="eyebrow">Schema</span>
          <h2>
            Editing <span className="mono">{branch}</span>
          </h2>
          <p>
            Every change here is one commit on this branch. Names are click-to-edit — renaming keeps
            the entity's identity, so a merge can tell a rename apart from a drop-and-re-add.
          </p>
        </div>
        <form className="btn-row" onSubmit={addTable}>
          <input
            className="input mono"
            placeholder="table name"
            aria-label="New table name"
            value={newTable}
            onChange={(e) => setNewTable(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!newTable.trim()}>
            + New table
          </button>
        </form>
      </div>

      {schema.tables.length === 0 ? (
        <div className="empty">
          No tables on <span className="mono">{branch}</span> yet. Create one to start building the
          schema.
        </div>
      ) : (
        schema.tables.map((table) => <TableCard key={table.id} table={table} onOp={onOp} />)
      )}
    </div>
  );
}
