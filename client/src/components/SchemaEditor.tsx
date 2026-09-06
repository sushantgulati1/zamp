import { useMemo, useState } from 'react';
import type { Schema } from '../lib/types';
import { TableCard, type OpDispatch } from './TableCard';
import { IconPlus, IconSearch, IconTable } from './icons';

/**
 * Tables live in their own column rather than stacked down the page: a schema
 * with a dozen tables is unreadable linearly, and picking one is the first
 * thing you do on this screen.
 */
export function SchemaEditor({
  schema,
  branch,
  selectedTableId,
  onSelectTable,
  onOp,
}: {
  schema: Schema;
  branch: string;
  selectedTableId: string | null;
  onSelectTable: (id: string) => void;
  onOp: OpDispatch;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTable, setNewTable] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? schema.tables.filter((t) => t.name.toLowerCase().includes(q)) : schema.tables;
  }, [schema.tables, query]);

  const selected = schema.tables.find((t) => t.id === selectedTableId) ?? null;

  const submitTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.trim()) return;
    onOp('createTable', { name: newTable.trim() });
    setNewTable('');
    setAdding(false);
  };

  return (
    <div className="schema-split">
      <aside className="table-pane">
        <div className="pane-head">
          <div>
            <h3>Tables</h3>
            <span className="tiny muted">
              {schema.tables.length} in <span className="mono">{branch}</span>
            </span>
          </div>
          <span className="spacer" />
          <button
            className="btn btn-icon"
            aria-label="New table"
            title="New table"
            onClick={() => setAdding((v) => !v)}
          >
            <IconPlus />
          </button>
        </div>

        {adding && (
          <form className="pane-add" onSubmit={submitTable}>
            <input
              className="input mono"
              placeholder="table name"
              aria-label="New table name"
              autoFocus
              value={newTable}
              onChange={(e) => setNewTable(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNewTable('');
                  setAdding(false);
                }
              }}
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!newTable.trim()}>
              Create
            </button>
          </form>
        )}

        {schema.tables.length > 0 && (
          <div className="search">
            <IconSearch />
            <input
              className="search-input"
              placeholder="Find a table"
              aria-label="Find a table"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {schema.tables.length === 0 ? (
          <p className="pane-empty">
            No tables on <span className="mono">{branch}</span> yet.
          </p>
        ) : filtered.length === 0 ? (
          <p className="pane-empty">No table matches “{query}”.</p>
        ) : (
          <ul className="pane-list">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  className={`pane-item ${t.id === selectedTableId ? 'active' : ''}`}
                  aria-current={t.id === selectedTableId ? 'true' : undefined}
                  onClick={() => onSelectTable(t.id)}
                >
                  <IconTable />
                  <span className="pane-item-name">{t.name}</span>
                  <span className="pane-count">{t.columns.length}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="table-detail">
        {selected ? (
          <TableCard table={selected} onOp={onOp} />
        ) : (
          <div className="empty">
            {schema.tables.length === 0
              ? 'Create a table to start building this schema.'
              : 'Select a table from the list to edit it.'}
          </div>
        )}
      </div>
    </div>
  );
}
