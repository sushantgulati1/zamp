import { useState } from 'react';
import type { Table } from '../lib/types';
import type { ConstraintType } from '../lib/types';
import { formatType } from '../lib/format';
import { ConfirmDialog, InlineEdit } from './ui';

export type OpDispatch = (op: string, payload: unknown) => void;

/** Offered in the type dropdown; free text is still allowed via the "other" path. */
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
      <section className="card">
        <header className="card-head">
          <InlineEdit
            className="card-title"
            ariaLabel={`Table ${table.name}`}
            hint="rename"
            value={table.name}
            onCommit={(name) => onOp('renameTable', { tableId: table.id, name })}
          />
          <span className="badge">
            {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'}
          </span>
          {table.indexes.length > 0 && (
            <span className="badge">
              {table.indexes.length} {table.indexes.length === 1 ? 'index' : 'indexes'}
            </span>
          )}
          {table.constraints.length > 0 && (
            <span className="badge">
              {table.constraints.length}{' '}
              {table.constraints.length === 1 ? 'constraint' : 'constraints'}
            </span>
          )}
          <span className="spacer" />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setConfirmDrop(true)}
            aria-label={`Drop table ${table.name}`}
          >
            Drop table
          </button>
        </header>

        <ColumnsSection table={table} onOp={onOp} />
        <IndexesSection table={table} onOp={onOp} />
        <ConstraintsSection table={table} onOp={onOp} />
      </section>

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

function ColumnsSection({ table, onOp }: { table: Table; onOp: OpDispatch }) {
  return (
    <div className="card-section">
      <div className="section-head">
        <span className="eyebrow">Columns</span>
      </div>

      {table.columns.length === 0 ? (
        <div className="empty">No columns yet — add the first one below.</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Null</th>
                <th>Default</th>
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
                    <InlineEdit
                      className="mono muted"
                      ariaLabel={`Default for ${col.name}`}
                      hint="set a default"
                      value={col.default ?? '—'}
                      onCommit={(next) =>
                        onOp('setColumnDefault', {
                          tableId: table.id,
                          columnId: col.id,
                          // "—" is the placeholder for "no default"; typing it back clears it.
                          value: next === '—' ? undefined : next,
                        })
                      }
                    />
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
                      className="btn btn-sm btn-ghost"
                      aria-label={`Drop column ${col.name}`}
                      onClick={() =>
                        onOp('dropColumn', { tableId: table.id, columnId: col.id })
                      }
                    >
                      Drop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddColumnForm table={table} onOp={onOp} />
    </div>
  );
}

function AddColumnForm({ table, onOp }: { table: Table; onOp: OpDispatch }) {
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
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="field grow">
        <label htmlFor={`col-name-${table.id}`}>Column name</label>
        <input
          id={`col-name-${table.id}`}
          className="input mono"
          placeholder="email"
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
        <input
          type="checkbox"
          checked={nullable}
          onChange={(e) => setNullable(e.target.checked)}
        />
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

function IndexesSection({ table, onOp }: { table: Table; onOp: OpDispatch }) {
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
    <div className="card-section">
      <div className="section-head">
        <span className="eyebrow">Indexes</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : '+ Index'}
        </button>
      </div>

      {table.indexes.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          No indexes on this table.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <tbody>
              {table.indexes.map((idx) => (
                <tr key={idx.id}>
                  <td className="cell-name">{idx.name}</td>
                  <td className="mono muted">({columnNames(idx.columnIds)})</td>
                  <td style={{ width: 1 }}>{idx.unique && <span className="badge">UNIQUE</span>}</td>
                  <td className="actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      aria-label={`Drop index ${idx.name}`}
                      onClick={() => onOp('dropIndex', { tableId: table.id, indexId: idx.id })}
                    >
                      Drop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <form className="add-form" onSubmit={submit}>
          <div className="field grow">
            <label htmlFor={`idx-name-${table.id}`}>Index name</label>
            <input
              id={`idx-name-${table.id}`}
              className="input mono"
              placeholder="idx_users_email"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field grow" style={{ flex: 2 }}>
            <label>Columns</label>
            <div className="chip-picker">
              {table.columns.length === 0 && <span className="muted">Add a column first</span>}
              {table.columns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${picked.includes(c.id) ? 'on' : ''}`}
                  aria-pressed={picked.includes(c.id)}
                  onClick={() =>
                    setPicked((p) =>
                      p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]
                    )
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
            unique
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!name.trim() || picked.length === 0}
          >
            Add index
          </button>
        </form>
      )}
    </div>
  );
}

// ---------- Constraints ----------

function ConstraintsSection({ table, onOp }: { table: Table; onOp: OpDispatch }) {
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
    <div className="card-section">
      <div className="section-head">
        <span className="eyebrow">Constraints</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : '+ Constraint'}
        </button>
      </div>

      {table.constraints.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          No constraints on this table.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <tbody>
              {table.constraints.map((c) => (
                <tr key={c.id}>
                  <td className="cell-name">{c.name}</td>
                  <td style={{ width: 1 }}>
                    <span className="badge">{c.type.replace('_', ' ')}</span>
                  </td>
                  <td className="mono muted">{c.definition}</td>
                  <td className="actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      aria-label={`Drop constraint ${c.name}`}
                      onClick={() =>
                        onOp('dropConstraint', { tableId: table.id, constraintId: c.id })
                      }
                    >
                      Drop
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <form className="add-form" onSubmit={submit}>
          <div className="field grow">
            <label htmlFor={`con-name-${table.id}`}>Constraint name</label>
            <input
              id={`con-name-${table.id}`}
              className="input mono"
              placeholder="chk_positive_total"
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
          <div className="field grow" style={{ flex: 2 }}>
            <label htmlFor={`con-def-${table.id}`}>Definition</label>
            <input
              id={`con-def-${table.id}`}
              className="input mono"
              placeholder="total >= 0"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!name.trim() || !definition.trim()}
          >
            Add constraint
          </button>
        </form>
      )}
    </div>
  );
}
