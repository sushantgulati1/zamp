import type { Conflict, Resolution, Schema } from '../lib/types';
import { fieldLabel, formatValue } from '../lib/format';

/**
 * The merge engine speaks ours/theirs; the UI speaks Target/Source.
 * `ours` is always the target branch (merged into) and `theirs` the source.
 * That mapping lives here and in `lib/types.ts` — nowhere else.
 */

const REASON_TEXT: Record<Conflict['reason'], string> = {
  'add-add':
    'Both branches independently created something with this identity, with different definitions.',
  'edit-edit': 'Both branches changed this since they split, in ways that disagree.',
  // modify-delete needs to name which branch did which, so it is built inline below.
  'modify-delete': '',
};

export function ConflictCard({
  conflict,
  schema,
  source,
  target,
  choice,
  onResolve,
  onUnresolve,
}: {
  conflict: Conflict;
  schema: Schema;
  source: string;
  target: string;
  choice?: Resolution;
  onResolve: (id: string, choice: Resolution) => void;
  onUnresolve: (id: string) => void;
}) {
  const tableName = schema.tables.find((t) => t.id === conflict.tableId)?.name ?? 'table';
  const entityName = nameOf(conflict) ?? 'entity';
  const path =
    conflict.kind === 'table' || conflict.kind === 'table-name'
      ? tableName
      : `${tableName}.${entityName}`;

  const isModifyDelete = conflict.reason === 'modify-delete';
  // `deletedSide` is in engine terms: "ours" = the target branch deleted it.
  const deletedBranch = conflict.deletedSide === 'ours' ? target : source;
  const keptBranch = conflict.deletedSide === 'ours' ? source : target;

  return (
    <section className={`conflict-card ${choice ? 'resolved' : ''}`}>
      <header className="conflict-head">
        <span className={`badge ${choice ? 'badge-add' : 'badge-conflict'}`}>
          {choice ? 'Resolved' : conflict.reason.replace('-', ' / ')}
        </span>
        <span className="conflict-path">{path}</span>
        <span className="badge">{conflict.kind.replace('-', ' ')}</span>
        <span className="spacer" />
        {choice && (
          <button className="btn btn-sm" onClick={() => onUnresolve(conflict.id)}>
            Undo decision
          </button>
        )}
      </header>

      <div className="conflict-body">
        <p className="conflict-why">
          {isModifyDelete ? (
            <>
              <span className="mono">{deletedBranch}</span> deleted this, while{' '}
              <span className="mono">{keptBranch}</span> modified it. There's no safe default here —
              either choice discards someone's work, so it's yours to make.
            </>
          ) : (
            REASON_TEXT[conflict.reason]
          )}
        </p>

        <ConflictTable conflict={conflict} source={source} target={target} choice={choice} />

        <div className="resolve-row">
          <span className="label">{choice ? 'Decision:' : 'Keep:'}</span>
          {isModifyDelete ? (
            <>
              <button
                className={`btn btn-sm ${choice === 'keep' ? 'picked' : ''}`}
                onClick={() => onResolve(conflict.id, 'keep')}
              >
                Keep the modified version
              </button>
              <button
                className={`btn btn-sm ${choice === 'delete' ? 'picked' : ''}`}
                onClick={() => onResolve(conflict.id, 'delete')}
              >
                Confirm the delete
              </button>
            </>
          ) : (
            <>
              <button
                className={`btn btn-sm ${choice === 'theirs' ? 'picked' : ''}`}
                onClick={() => onResolve(conflict.id, 'theirs')}
              >
                Source · <span className="mono">{source}</span>
              </button>
              <button
                className={`btn btn-sm ${choice === 'ours' ? 'picked' : ''}`}
                onClick={() => onResolve(conflict.id, 'ours')}
              >
                Target · <span className="mono">{target}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The compact Base / Source / Target table (decisions.md #12). One row per field
 * on the entity; rows where all three sides agree are muted, and the fields the
 * conflict actually turns on are highlighted. The pick is still whole-entity —
 * this table exists to make that pick legible, not to allow per-field choices.
 */
function ConflictTable({
  conflict,
  source,
  target,
  choice,
}: {
  conflict: Conflict;
  source: string;
  target: string;
  choice?: Resolution;
}) {
  // `table-name` conflicts carry bare strings rather than entity objects.
  const isScalar = conflict.kind === 'table-name';
  const { base, ours, theirs } = conflict;

  const rows: { field: string; base: unknown; source: unknown; target: unknown }[] = isScalar
    ? [{ field: 'name', base, source: theirs, target: ours }]
    : fieldsOf([base, ours, theirs]).map((field) => ({
        field,
        base: pick(base, field),
        source: pick(theirs, field),
        target: pick(ours, field),
      }));

  const differing = new Set(conflict.fieldsDiffering ?? []);
  const sourceAbsent = theirs === undefined;
  const targetAbsent = ours === undefined;

  // For a modify-delete, "keep" selects whichever side still has the entity and
  // "delete" selects the side that removed it — so the tint always lands on the
  // column describing the outcome.
  const sourceChosen =
    choice === 'theirs' ||
    (choice === 'keep' && targetAbsent) ||
    (choice === 'delete' && sourceAbsent);
  const targetChosen =
    choice === 'ours' ||
    (choice === 'keep' && sourceAbsent) ||
    (choice === 'delete' && targetAbsent);

  return (
    <div className="table-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th className="field">Field</th>
            <th>Base</th>
            <th className="pick">Source · {source}</th>
            <th className="pick">Target · {target}</th>
          </tr>
        </thead>
        <tbody>
          {(sourceAbsent || targetAbsent) && (
            <tr className="differs">
              <td className="field">presence</td>
              <td>present</td>
              <td className={sourceChosen ? 'chosen' : ''}>
                {sourceAbsent ? <span className="absent">deleted</span> : 'modified'}
              </td>
              <td className={targetChosen ? 'chosen' : ''}>
                {targetAbsent ? <span className="absent">deleted</span> : 'modified'}
              </td>
            </tr>
          )}
          {rows.map((r) => {
            // Highlight fields the engine flagged, plus (for a modify-delete)
            // any field that actually moved away from base on the surviving side.
            const changed =
              differing.has(r.field) ||
              (sourceAbsent || targetAbsent
                ? !same(r.base, sourceAbsent ? r.target : r.source)
                : false);
            return (
              <tr key={r.field} className={changed ? 'differs' : 'same'}>
                <td className="field">{fieldLabel(r.field)}</td>
                <td>
                  {base === undefined ? <span className="absent">—</span> : formatValue(r.base)}
                </td>
                <td className={sourceChosen ? 'chosen' : ''}>
                  {sourceAbsent ? <span className="absent">deleted</span> : formatValue(r.source)}
                </td>
                <td className={targetChosen ? 'chosen' : ''}>
                  {targetAbsent ? <span className="absent">deleted</span> : formatValue(r.target)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Union of field names across whichever sides are present, `id` omitted. */
function fieldsOf(sides: unknown[]): string[] {
  const fields = new Set<string>();
  for (const side of sides) {
    if (isRecord(side)) for (const k of Object.keys(side)) if (k !== 'id') fields.add(k);
  }
  return [...fields];
}

function pick(side: unknown, field: string): unknown {
  return isRecord(side) ? side[field] : undefined;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nameOf(conflict: Conflict): string | undefined {
  for (const side of [conflict.ours, conflict.theirs, conflict.base]) {
    if (isRecord(side) && typeof side.name === 'string') return side.name;
  }
  // `table-name` conflicts store the name itself rather than an entity.
  if (typeof conflict.ours === 'string') return conflict.ours;
  return undefined;
}
