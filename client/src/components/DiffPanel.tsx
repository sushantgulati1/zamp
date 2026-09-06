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

/**
 * Presentation-only rendering of a `SchemaDiff`. Takes both tip schemas
 * alongside the diff so entity ids appearing in it (table names that didn't
 * change, index column ids) can be resolved back to names.
 */
export function DiffPanel({
  diff,
  before,
  after,
}: {
  diff: SchemaDiff;
  before: Schema;
  after: Schema;
}) {
  const total =
    diff.tablesAdded.length + diff.tablesRemoved.length + diff.tablesChanged.length;

  if (total === 0) {
    return (
      <div className="banner ok">
        <div>
          <div className="banner-title">Nothing diverged</div>
          <p>These two branches describe exactly the same schema.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {diff.tablesAdded.map((t) => (
        <WholeTableCard key={t.id} table={t} tone="add" />
      ))}
      {diff.tablesRemoved.map((t) => (
        <WholeTableCard key={t.id} table={t} tone="del" />
      ))}
      {diff.tablesChanged.map((td) => (
        <ChangedTableCard key={td.id} diff={td} before={before} after={after} />
      ))}
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
          <p className="muted tiny">Empty table — no columns, indexes or constraints.</p>
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

function ChangedTableCard({
  diff,
  before,
  after,
}: {
  diff: TableDiff;
  before: Schema;
  after: Schema;
}) {
  const afterTable = after.tables.find((t) => t.id === diff.id);
  const beforeTable = before.tables.find((t) => t.id === diff.id);
  const columnName = (id: string) =>
    afterTable?.columns.find((c) => c.id === id)?.name ??
    beforeTable?.columns.find((c) => c.id === id)?.name ??
    '?';

  const count = (d: EntityDiff<unknown>) => d.added.length + d.removed.length + d.modified.length;
  const total =
    count(diff.columns) + count(diff.indexes) + count(diff.constraints) + (diff.name ? 1 : 0);

  const formatField = (field: string, value: unknown) =>
    field === 'columnIds' ? formatIds(value, columnName) : formatValue(value);

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
            (afterTable?.name ?? beforeTable?.name ?? diff.id)
          )}
        </span>
        <span className="spacer" />
        <span className="badge">
          {total} {total === 1 ? 'change' : 'changes'}
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
          formatField={formatField}
        />
        <EntityLines
          diff={diff.indexes}
          describe={(i: IndexDef) =>
            `index ${i.name} (${i.columnIds.map(columnName).join(', ')})${i.unique ? ' UNIQUE' : ''}`
          }
          label={(i: IndexDef) => i.name}
          formatField={formatField}
        />
        <EntityLines
          diff={diff.constraints}
          describe={describeConstraint}
          label={(c: ConstraintDef) => c.name}
          formatField={formatField}
        />
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
