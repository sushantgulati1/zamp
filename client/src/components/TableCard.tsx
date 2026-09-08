import { useState } from 'react';
import type { Table } from '../lib/types';
import type { ConstraintType } from '../lib/types';
import { formatType } from '../lib/format';
import { ConfirmDialog, InlineEdit } from './ui';
import { IconCheck, IconIndex, IconPlus, IconSchema, IconShield, IconTable, IconTrash } from './icons';

export type OpDispatch = (op: string, payload: unknown) => void;

/** Offered in the type dropdown; any other type can still be typed inline. */
const COMMON_TYPES = [
  'uuid',
  'text',
  'varchar',
  'integer',
  'bigint',
  'numeric',
  'boolean',
  'date',
  'timestamptz',
  'jsonb',
];

/** Types where a length modifier is meaningful — drives the length input. */
const SIZED_TYPES = new Set(['varchar', 'char', 'numeric', 'decimal']);

export function TableCard({ table, onOp }: { table: Table; onOp: OpDispatch }) {
  const [confirmDrop, setConfirmDrop] = useState(false);

  return (
    <>
      <header className="detail-head">
        <IconTable size={19} />
        <InlineEdit
          className="detail-title"
          ariaLabel={`Table ${table.name}`}
          hint="rename"
          value={table.name}
          onCommit={(name) => onOp('renameTable', { tableId: table.id, name })}
        />
        <span className="badge">
          {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'}
        </span>
        <span className="spacer" />
        <button className="btn btn-danger" onClick={() => setConfirmDrop(true)}>
          <IconTrash />
          Drop table
        </button>
      </header>

      <ColumnsCard table={table} onOp={onOp} />

      <div className="detail-grid">
        <IndexesCard table={table} onOp={onOp} />
        <ConstraintsCard table={table} onOp={onOp} />
      </div>

      {confirmDrop && (
        <ConfirmDialog
          title="Drop table"
          message={
            <>
              Drop <strong className="mono">{table.name}</strong> and all of its columns, indexes
              and constraints? This is recorded as a commit, so you can still branch from before it.
            </>
          }
          confirmLabel="Drop table"
          onConfirm={() => {
            setConfirmDrop(false);
            onOp('dropTable', { tableId: table.id });
          }}
          onCancel={() => setConfirmDrop(false)}
        />
      )}
    </>
  );
}

// ---------- Columns ----------

function ColumnsCard({ table, onOp }: { table: Table; onOp: OpDispatch }) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="card">
      <header className="card-head">
        <IconSchema />
        <span className="eyebrow">Columns</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setAdding((v) => !v)}>
          <IconPlus />
          {adding ? 'Cancel' : 'Add column'}
        </button>
      </header>

      <div className="card-section">
        {table.columns.length === 0 ? (
          <div className="empty">No columns yet — add the first one.</div>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Null</th>
                  <th>Key</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.columns.map((col) => (
                  <tr key={col.id}>
                    <td>
                      <InlineEdit
                        className="cell-name"
                        ariaLabel={`Column ${col.name}`}
                        hint="rename"
                        value={col.name}
                        onCommit={(name) =>
                          onOp('renameColumn', { tableId: table.id, columnId: col.id, name })
                        }
                      />
                    </td>
                    <td>
                      <InlineEdit
                        className="cell-type"
                        ariaLabel={`Type of ${col.name}`}
                        hint="retype"
                        value={formatType(col)}
                        onCommit={(next) => {
                          // Accept `varchar(255)` as typed and split it back apart.
                          const match = /^([^(]+?)\s*\(\s*(\d+)\s*\)$/.exec(next);
                          onOp('retypeColumn', {
                            tableId: table.id,
                            columnId: col.id,
                            input: match
                              ? { type: match[1], length: Number(match[2]) }
                              : { type: next },
                          });
                        }}
                      />
                    </td>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          aria-label={`${col.name} nullable`}
                          onChange={(e) =>
                            onOp('setColumnNullable', {
                              tableId: table.id,
                              columnId: col.id,
                              nullable: e.target.checked,
                            })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={col.primaryKey}
                          aria-label={`${col.name} primary key`}
                          onChange={(e) =>
                            onOp('setColumnPrimaryKey', {
                              tableId: table.id,
                              columnId: col.id,
                              pk: e.target.checked,
                            })
                          }
                        />
                        {col.primaryKey && <span className="badge badge-pk">PK</span>}
                      </label>
                    </td>
                    <td className="actions">
                      <button
                        className="btn btn-sm btn-icon btn-ghost"
                        aria-label={`Drop column ${col.name}`}
                        title={`Drop column ${col.name}`}
                        onClick={() => onOp('dropColumn', { tableId: table.id, columnId: col.id })}
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {adding && <AddColumnForm table={table} onOp={onOp} onDone={() => setAdding(false)} />}
      </div>
    </section>
  );
}

function AddColumnForm({
  table,
  onOp,
  onDone,
}: {
  table: Table;
  onOp: OpDispatch;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [length, setLength] = useState('');
  const [nullable, setNullable] = useState(true);
  const [primaryKey, setPrimaryKey] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onOp('addColumn', {
      tableId: table.id,
      input: {
        name: name.trim(),
        type,
        length: SIZED_TYPES.has(type) && length ? Number(length) : undefined,
        nullable,
        primaryKey,
      },
    });
    setName('');
    setLength('');
    setNullable(true);
    setPrimaryKey(false);
    onDone();
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="field grow">
        <label htmlFor={`col-name-${table.id}`}>Column name</label>
        <input
          id={`col-name-${table.id}`}
          className="input mono"
          placeholder="email"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`col-type-${table.id}`}>Type</label>
        <select
          id={`col-type-${table.id}`}
          className="select mono"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {COMMON_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {SIZED_TYPES.has(type) && (
        <div className="field">
          <label htmlFor={`col-len-${table.id}`}>Length</label>
          <input
            id={`col-len-${table.id}`}
            className="input mono"
            style={{ width: 78 }}
            placeholder="255"
            inputMode="numeric"
            value={length}
            onChange={(e) => setLength(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={nullable} onChange={(e) => setNullable(e.target.checked)} />
        nullable
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={primaryKey}
          onChange={(e) => setPrimaryKey(e.target.checked)}
        />
        primary key
      </label>
      <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
        Add column
      </button>
    </form>
  );
}

// ---------- Indexes ----------

function IndexesCard({ table, onOp }: { table: Table; onOp: OpDispatch }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const columnNames = (ids: string[]) =>
    ids.map((id) => table.columns.find((c) => c.id === id)?.name ?? '?').join(', ');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || picked.length === 0) return;
    onOp('addIndex', { tableId: table.id, input: { name: name.trim(), columnIds: picked, unique } });
    setName('');
    setUnique(false);
    setPicked([]);
    setOpen(false);
  };

  return (
    <section className="card">
      <header className="card-head">
        <IconIndex />
        <span className="eyebrow">Indexes</span>
        <span className="spacer" />
        <button
          className="btn btn-icon btn-sm"
          aria-label={open ? 'Cancel new index' : 'Add index'}
          title={open ? 'Cancel' : 'Add index'}
          onClick={() => setOpen((v) => !v)}
        >
          <IconPlus />
        </button>
      </header>

      <div className="card-section">
        {table.indexes.length === 0 ? (
          <p className="muted tiny">No indexes on this table.</p>
        ) : (
          <ul className="mini-list">
            {table.indexes.map((idx) => (
              <li key={idx.id}>
                <span className="mini-name">{idx.name}</span>
                <span className="mini-meta mono">({columnNames(idx.columnIds)})</span>
                {idx.unique && <span className="badge">UNIQUE</span>}
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-icon btn-ghost"
                  aria-label={`Drop index ${idx.name}`}
                  title={`Drop index ${idx.name}`}
                  onClick={() => onOp('dropIndex', { tableId: table.id, indexId: idx.id })}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <form className="add-form stacked" onSubmit={submit}>
            <div className="field">
              <label htmlFor={`idx-name-${table.id}`}>Index name</label>
              <input
                id={`idx-name-${table.id}`}
                className="input mono"
                placeholder="idx_users_email"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label id={`idx-cols-${table.id}`}>
                Select columns
                {picked.length > 0 && <span className="label-count">{picked.length} selected</span>}
              </label>
              <div
                className="chip-picker"
                role="group"
                aria-labelledby={`idx-cols-${table.id}`}
              >
                {table.columns.length === 0 && (
                  <span className="muted tiny">Add a column first</span>
                )}
                {table.columns.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((p) =>
                          p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]
                        )
                      }
                    >
                      {on && <IconCheck size={11} />}
                      {c.name}
                    </button>
                  );
                })}
              </div>
              {table.columns.length > 0 && picked.length === 0 && (
                <span className="field-hint">Pick at least one column to index.</span>
              )}
            </div>
            <div className="btn-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(e) => setUnique(e.target.checked)}
                />
                unique
              </label>
              <span className="spacer" />
              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={!name.trim() || picked.length === 0}
              >
                Add index
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ---------- Constraints ----------

function ConstraintsCard({ table, onOp }: { table: Table; onOp: OpDispatch }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ConstraintType>('check');
  const [definition, setDefinition] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !definition.trim()) return;
    onOp('addConstraint', {
      tableId: table.id,
      input: { name: name.trim(), type, definition: definition.trim() },
    });
    setName('');
    setDefinition('');
    setOpen(false);
  };

  return (
    <section className="card">
      <header className="card-head">
        <IconShield />
        <span className="eyebrow">Constraints</span>
        <span className="spacer" />
        <button
          className="btn btn-icon btn-sm"
          aria-label={open ? 'Cancel new constraint' : 'Add constraint'}
          title={open ? 'Cancel' : 'Add constraint'}
          onClick={() => setOpen((v) => !v)}
        >
          <IconPlus />
        </button>
      </header>

      <div className="card-section">
        {table.constraints.length === 0 ? (
          <p className="muted tiny">No constraints on this table.</p>
        ) : (
          <ul className="mini-list">
            {table.constraints.map((c) => (
              <li key={c.id}>
                <span className="mini-name">{c.name}</span>
                <span className="badge">{c.type.replace('_', ' ')}</span>
                <span className="mini-meta mono">{c.definition}</span>
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-icon btn-ghost"
                  aria-label={`Drop constraint ${c.name}`}
                  title={`Drop constraint ${c.name}`}
                  onClick={() => onOp('dropConstraint', { tableId: table.id, constraintId: c.id })}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <form className="add-form stacked" onSubmit={submit}>
            <div className="field">
              <label htmlFor={`con-name-${table.id}`}>Constraint name</label>
              <input
                id={`con-name-${table.id}`}
                className="input mono"
                placeholder="chk_positive_total"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`con-type-${table.id}`}>Type</label>
              <select
                id={`con-type-${table.id}`}
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value as ConstraintType)}
              >
                <option value="check">check</option>
                <option value="foreign_key">foreign key</option>
                <option value="unique">unique</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`con-def-${table.id}`}>Definition</label>
              <input
                id={`con-def-${table.id}`}
                className="input mono"
                placeholder="total >= 0"
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <span className="spacer" />
              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={!name.trim() || !definition.trim()}
              >
                Add constraint
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
