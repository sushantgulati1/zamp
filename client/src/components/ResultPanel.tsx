import type { ReactNode } from 'react';
import type { ResultRow, ResultTable, State } from '../lib/result';
import { fieldLabel } from '../lib/format';
import { IconHash, IconShield, IconTable } from './icons';

/**
 * The merged schema as it would land on the target, table by table: every
 * surviving column, index and constraint, tinted by what the merge does to it,
 * with redefined entities carrying their own before → after detail.
 *
 * This is the only inventory the sheet shows. A separate list of changes said
 * the same thing twice — everything it carried (adds, drops, redefinitions) is
 * visible here, in the context of the schema it produces.
 */

const MARK: Record<State, string> = { add: '+', del: '−', mod: '~', same: '' };

export function ResultPanel({ tables }: { tables: ResultTable[] }) {
  return (
    <div className="result-list">
      {tables.map((t) => (
        <section key={t.key} className={`result-table ${t.state ? `tone-${t.state}` : ''}`}>
          <header className="result-head">
            <IconTable size={13} />
            <span className="result-name mono">{t.name}</span>
            {t.renamedFrom && (
              <span className="result-renamed">
                was <span className="mono">{t.renamedFrom}</span>
              </span>
            )}
            {t.state && (
              <span className={`badge badge-${t.state === 'del' ? 'del' : 'add'}`}>
                {t.state === 'del' ? 'dropped' : 'new table'}
              </span>
            )}
            <span className="spacer" />
            <span className="result-changes">
              {t.changes} {t.changes === 1 ? 'change' : 'changes'}
            </span>
          </header>
          <div className="result-body">
            <ResultSection label="Columns" icon={<IconTable size={12} />} rows={t.columns} />
            <ResultSection label="Indexes" icon={<IconHash size={12} />} rows={t.indexes} />
            <ResultSection
              label="Constraints"
              icon={<IconShield size={12} />}
              rows={t.constraints}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function ResultSection({
  label,
  icon,
  rows,
}: {
  label: string;
  icon: ReactNode;
  rows: ResultRow[];
}) {
  const kept = rows.filter((r) => r.state !== 'del').length;

  return (
    <div className="result-section">
      <div className="result-section-head">
        <span className="result-section-icon">{icon}</span>
        <span className="result-section-label">{label}</span>
        <span className="result-section-count">{kept}</span>
      </div>
      {rows.length === 0 ? (
        <p className="result-none">none</p>
      ) : (
        <ul className="result-rows">
          {rows.map((r) => (
            <li key={r.key} className={`result-row is-${r.state}`}>
              <span className="result-mark" aria-hidden="true">
                {MARK[r.state]}
              </span>
              <span className="result-row-main">
                <span className="result-row-name mono">{r.name}</span>
                {r.fields && r.fields.length > 0 && (
                  <span className="result-row-change">
                    {r.fields.map((f, i) => (
                      <span key={f.field} className="transition">
                        {i > 0 && <span className="transition-sep">·</span>}
                        <span className="transition-label">{fieldLabel(f.field)}</span>
                        <span className="val was">{f.from}</span>
                        <span className="arrow">→</span>
                        <span className="val now">{f.to}</span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="spacer" />
              <span className="result-row-meta">{r.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
