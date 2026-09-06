import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type {
  Column,
  ConstraintDef,
  EntityDiff,
  IndexDef,
  Schema,
  SchemaDiff,
  Table,
  TableDiff,
} from '../lib/types';
import { fieldLabel, formatType, formatValue } from '../lib/format';

interface Loaded {
  diff: SchemaDiff;
  /** Both tip schemas, kept so ids appearing in the diff can be resolved to names. */
  before: Schema;
  after: Schema;
}

export function DiffView({
  repoId,
  branches,
  current,
  onError,
}: {
  repoId: string;
  branches: string[];
  current: string;
  onError: (message: string) => void;
}) {
  const [from, setFrom] = useState(() => branches.find((b) => b !== current) ?? current);
  const [to, setTo] = useState(current);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (from === to) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.diff(repoId, from, to),
      api.getSchema(repoId, from),
      api.getSchema(repoId, to),
    ])
      .then(([diff, before, after]) => {
        if (!cancelled) setLoaded({ diff, before, after });
      })
      .catch((e: ApiError) => {
        if (!cancelled) {
          setLoaded(null);
          onError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `onError` is a stable callback from App; refetch only when the pair changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, from, to]);

  const diff = loaded?.diff;
  const changedCount = diff
    ? diff.tablesAdded.length + diff.tablesRemoved.length + diff.tablesChanged.length
    : 0;

  return (
    <div className="content-inner">
      <div className="view-head">
        <div>
          <span className="eyebrow">Diff</span>
          <h2>Compare two branches</h2>
          <p>
            A structural comparison of the two tip schemas, matched on entity identity rather than
            name — so a rename shows up as a rename, not as a drop plus an unrelated add.
          </p>
        </div>
        <div className="diff-pickers">
          <BranchSelect label="From" value={from} branches={branches} onChange={setFrom} />
          <span className="diff-arrow" aria-hidden="true">
            →
          </span>
          <BranchSelect label="To" value={to} branches={branches} onChange={setTo} />
        </div>
      </div>

      {from === to ? (
        <div className="empty">
          Pick two different branches to compare — <span className="mono">{from}</span> is selected
          on both sides.
        </div>
      ) : loading && !loaded ? (
        <div className="empty">Computing diff…</div>
      ) : !loaded || !diff ? null : changedCount === 0 ? (
        <div className="banner ok">
          <div>
            <div className="banner-title">Identical schemas</div>
            <p>
              <span className="mono">{from}</span> and <span className="mono">{to}</span> describe
              exactly the same schema.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="summary-row">
            <Stat n={diff.tablesAdded.length} label="tables added" tone="add" />
            <Stat n={diff.tablesRemoved.length} label="tables removed" tone="del" />
            <Stat n={diff.tablesChanged.length} label="tables changed" tone="mod" />
          </div>

          {diff.tablesAdded.map((t) => (
            <WholeTableCard key={t.id} table={t} tone="add" />
          ))}
          {diff.tablesRemoved.map((t) => (
            <WholeTableCard key={t.id} table={t} tone="del" />
          ))}
          {diff.tablesChanged.map((td) => (
            <ChangedTableCard key={td.id} diff={td} loaded={loaded} />
          ))}
        </>
      )}
    </div>
  );
}

function BranchSelect({
  label,
  value,
  branches,
  onChange,
}: {
  label: string;
  value: string;
  branches: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={`diff-${label}`}>{label}</label>
      <select
        id={`diff-${label}`}
        className="select mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="n">{n}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

/** A table that exists on only one side — everything in it is listed wholesale. */
function WholeTableCard({ table, tone }: { table: Table; tone: 'add' | 'del' }) {
  const sign = tone === 'add' ? '+' : '−';
  const lines = [
    ...table.columns.map((c) => ({ key: c.id, text: describeColumn(c) })),
    ...table.indexes.map((i) => ({ key: i.id, text: describeIndex(i, table) })),
    ...table.constraints.map((c) => ({ key: c.id, text: describeConstraint(c) })),
  ];

  return (
    <section className="card">
      <header className="card-head">
        <span className={`badge badge-${tone}`}>
          {tone === 'add' ? 'Table added' : 'Table removed'}
        </span>
        <span className="card-title">{table.name}</span>
      </header>
      <div className="card-section">
        {lines.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Empty table — no columns, indexes or constraints.
          </p>
        ) : (
          lines.map((l) => (
            <div key={l.key} className={`dline ${tone}`}>
              <span className="sign">{sign}</span>
              <span>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ChangedTableCard({ diff, loaded }: { diff: TableDiff; loaded: Loaded }) {
  // The table exists on both sides; use the "after" version for names and for
  // resolving index column ids, falling back to "before" for removed columns.
  const after = loaded.after.tables.find((t) => t.id === diff.id);
  const before = loaded.before.tables.find((t) => t.id === diff.id);
  const columnName = (id: string) =>
    after?.columns.find((c) => c.id === id)?.name ??
    before?.columns.find((c) => c.id === id)?.name ??
    '?';

  const count = (d: EntityDiff<unknown>) => d.added.length + d.removed.length + d.modified.length;
  const total = count(diff.columns) + count(diff.indexes) + count(diff.constraints);

  return (
    <section className="card">
      <header className="card-head">
        <span className="badge">Table changed</span>
        <span className="card-title">
          {diff.name ? (
            <>
              <span className="val was">{diff.name.from}</span>
              <span className="arrow">→</span>
              <span className="val now">{diff.name.to}</span>
            </>
          ) : (
            (after?.name ?? before?.name ?? diff.id)
          )}
        </span>
        <span className="spacer" />
        <span className="badge">
          {total + (diff.name ? 1 : 0)} {total + (diff.name ? 1 : 0) === 1 ? 'change' : 'changes'}
        </span>
      </header>

      <div className="card-section">
        {diff.name && (
          <div className="dline mod">
            <span className="sign">~</span>
            <span>
              table renamed <span className="val was">{diff.name.from}</span>
              <span className="arrow">→</span>
              <span className="val now">{diff.name.to}</span>
            </span>
          </div>
        )}
        <EntityLines
          diff={diff.columns}
          describe={describeColumn}
          label={(c: Column) => c.name}
          formatField={(field, value) =>
            field === 'columnIds' ? formatIds(value, columnName) : formatValue(value)
          }
        />
        <EntityLines
          diff={diff.indexes}
          describe={(i: IndexDef) =>
            `index ${i.name} (${i.columnIds.map(columnName).join(', ')})${i.unique ? ' UNIQUE' : ''}`
          }
          label={(i: IndexDef) => i.name}
          formatField={(field, value) =>
            field === 'columnIds' ? formatIds(value, columnName) : formatValue(value)
          }
        />
        <EntityLines
          diff={diff.constraints}
          describe={describeConstraint}
          label={(c: ConstraintDef) => c.name}
          formatField={(field, value) =>
            field === 'columnIds' ? formatIds(value, columnName) : formatValue(value)
          }
        />
        {total === 0 && !diff.name && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            No entity-level changes.
          </p>
        )}
      </div>
    </section>
  );
}

/** Renders one collection's added / removed / modified entries as diff lines. */
function EntityLines<T extends { id: string }>({
  diff,
  describe,
  label,
  formatField,
}: {
  diff: EntityDiff<T>;
  describe: (e: T) => string;
  label: (e: T) => string;
  formatField: (field: string, value: unknown) => string;
}) {
  return (
    <>
      {diff.added.map((e) => (
        <div key={`a-${e.id}`} className="dline add">
          <span className="sign">+</span>
          <span>{describe(e)}</span>
        </div>
      ))}
      {diff.removed.map((e) => (
        <div key={`r-${e.id}`} className="dline del">
          <span className="sign">−</span>
          <span>{describe(e)}</span>
        </div>
      ))}
      {diff.modified.map((m) => (
        <div key={`m-${m.id}`} className="dline mod">
          <span className="sign">~</span>
          <span>
            <strong>{label(m.after)}</strong>
            <span className="detail">
              {' '}
              {m.fields.map((f, i) => (
                <span key={f.field}>
                  {i > 0 && ', '}
                  {fieldLabel(f.field)}{' '}
                  <span className="val was">{formatField(f.field, f.from)}</span>
                  <span className="arrow">→</span>
                  <span className="val now">{formatField(f.field, f.to)}</span>
                </span>
              ))}
            </span>
          </span>
        </div>
      ))}
    </>
  );
}

/** Column-id arrays read as ids otherwise; map them back to names. */
function formatIds(value: unknown, columnName: (id: string) => string): string {
  if (!Array.isArray(value)) return formatValue(value);
  return value.length ? value.map((id) => columnName(String(id))).join(', ') : '—';
}

function describeColumn(c: Column): string {
  const parts = [c.name, formatType(c)];
  if (!c.nullable) parts.push('NOT NULL');
  if (c.primaryKey) parts.push('PRIMARY KEY');
  if (c.default !== undefined) parts.push(`DEFAULT ${c.default}`);
  return parts.join('  ');
}

function describeIndex(i: IndexDef, table: Table): string {
  const cols = i.columnIds
    .map((id) => table.columns.find((c) => c.id === id)?.name ?? '?')
    .join(', ');
  return `index ${i.name} (${cols})${i.unique ? ' UNIQUE' : ''}`;
}

function describeConstraint(c: ConstraintDef): string {
  return `constraint ${c.name} ${c.type.replace('_', ' ')} — ${c.definition}`;
}
