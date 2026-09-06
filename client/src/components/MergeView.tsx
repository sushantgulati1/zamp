import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Conflict, MergeResult, Resolution, ResolutionMap, Schema } from '../lib/types';
import { fieldLabel, formatValue } from '../lib/format';

/**
 * The merge engine speaks ours/theirs; the UI speaks Target/Source.
 * `ours` is always the target branch (the one being merged into) and `theirs`
 * the source branch. Every label in this file goes through that mapping.
 */
export function MergeView({
  repoId,
  branches,
  current,
  onMerged,
  onError,
}: {
  repoId: string;
  branches: string[];
  current: string;
  onMerged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState(current);
  const [source, setSource] = useState(() => branches.find((b) => b !== current) ?? current);
  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [preview, setPreview] = useState<MergeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  /**
   * Every conflict this pair of tips has surfaced, in the order first seen.
   * The server returns only *unresolved* conflicts, so without this a card would
   * vanish the moment it was decided — leaving no way to review or change the
   * call. Cards are rendered from here and cross-referenced against the live
   * preview to know which are still outstanding.
   */
  const [seen, setSeen] = useState<Conflict[]>([]);

  // Switching either branch invalidates every resolution — conflict ids are
  // tied to the specific pair of tips being merged.
  useEffect(() => {
    setResolutions({});
    setSeen([]);
  }, [source, target]);

  const samePair = source === target;

  useEffect(() => {
    if (samePair) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .mergePreview(repoId, source, target, resolutions)
      .then((r) => {
        if (cancelled) return;
        setPreview(r);
        setSeen((prev) => {
          const known = new Set(prev.map((c) => c.id));
          const added = r.conflicts.filter((c) => !known.has(c.id));
          return added.length ? [...prev, ...added] : prev;
        });
      })
      .catch((e: ApiError) => {
        if (!cancelled) {
          setPreview(null);
          onError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-previews on every resolution change: the server is the single source of
    // truth for merge computation (LOW_LEVEL_DESIGN.md §8).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, source, target, resolutions, samePair]);

  const resolve = useCallback((conflictId: string, choice: Resolution) => {
    setResolutions((prev) => ({ ...prev, [conflictId]: choice }));
  }, []);

  /** Puts a decided conflict back in play so the choice can be reconsidered. */
  const unresolve = useCallback((conflictId: string) => {
    setResolutions((prev) => {
      const next = { ...prev };
      delete next[conflictId];
      return next;
    });
  }, []);

  const apply = async () => {
    setApplying(true);
    try {
      const result = await api.mergeApply(repoId, source, target, resolutions);
      setResolutions({});
      setSeen([]);
      onMerged(
        result.fastForward
          ? `Fast-forwarded ${target} to ${source}.`
          : `Merged ${source} into ${target}.`
      );
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setApplying(false);
    }
  };

  // Anything the server still returns is outstanding; everything else in `seen`
  // has been decided. Cards for conflicts that are neither outstanding nor
  // decided are dropped — those no longer apply after an earlier choice.
  const outstandingIds = new Set((preview?.conflicts ?? []).map((c) => c.id));
  const cards = seen.filter((c) => outstandingIds.has(c.id) || resolutions[c.id]);
  const outstanding = outstandingIds.size;
  const decisions = cards.filter((c) => resolutions[c.id]).length;
  const canApply = Boolean(preview) && outstanding === 0 && !applying && !samePair;

  return (
    <div className="content-inner">
      <div className="view-head">
        <div>
          <span className="eyebrow">Merge</span>
          <h2>Merge one branch into another</h2>
          <p>
            Computed as a three-way merge against the branches' common ancestor. Changes that don't
            overlap merge on their own; anything both sides changed incompatibly needs a decision.
          </p>
        </div>
      </div>

      <div className="merge-bar">
        <div className="field">
          <label htmlFor="merge-source">Merge from (source)</label>
          <select
            id="merge-source"
            className="select mono"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <span className="diff-arrow" aria-hidden="true">
          →
        </span>
        <div className="field">
          <label htmlFor="merge-target">Into (target)</label>
          <select
            id="merge-target"
            className="select mono"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <span className="spacer" />
        {outstanding > 0 && (
          <span className="badge badge-conflict">
            {outstanding} unresolved
            {decisions > 0 && ` · ${decisions} decided`}
          </span>
        )}
        <button className="btn btn-primary" disabled={!canApply} onClick={apply}>
          {applying ? 'Merging…' : `Merge into ${target}`}
        </button>
      </div>

      {samePair ? (
        <div className="empty">
          Pick two different branches — <span className="mono">{source}</span> is selected as both
          source and target.
        </div>
      ) : loading && !preview ? (
        <div className="empty">Computing merge…</div>
      ) : !preview ? null : (
        <>
          {preview.fastForward && (
            <div className="banner info">
              <div>
                <div className="banner-title">Fast-forward</div>
                <p>
                  <span className="mono">{target}</span> hasn't diverged from{' '}
                  <span className="mono">{source}</span>, so merging just moves its pointer forward.
                  No merge commit is created.
                </p>
              </div>
            </div>
          )}

          {outstanding === 0 ? (
            <div className="banner ok">
              <div>
                <div className="banner-title">
                  {decisions > 0 ? 'All conflicts resolved' : 'Clean merge'}
                </div>
                <p>
                  {decisions > 0
                    ? 'Every conflict has a decision. Applying will create a merge commit with two parents.'
                    : 'Nothing overlaps — this merges automatically with no decisions needed.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="banner warn">
              <div>
                <div className="banner-title">
                  {outstanding} {outstanding === 1 ? 'conflict needs' : 'conflicts need'} a decision
                </div>
                <p>
                  Both branches changed the same thing since they split. Pick which version survives
                  — the merge can't be applied until every one is decided.
                </p>
              </div>
            </div>
          )}

          <div className="summary-row">
            <Stat n={preview.schema.tables.length} label="tables after merge" tone="mod" />
            <Stat n={outstanding} label="unresolved" tone="conflict" />
            <Stat n={decisions} label="decisions made" tone="add" />
          </div>

          {cards.map((c) => (
            <ConflictCard
              key={c.id}
              conflict={c}
              schema={preview.schema}
              source={source}
              target={target}
              choice={resolutions[c.id]}
              onResolve={resolve}
              onUnresolve={unresolve}
            />
          ))}
        </>
      )}
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

// ---------- One conflict ----------

const REASON_TEXT: Record<Conflict['reason'], string> = {
  'add-add': 'Both branches independently created something with this identity, with different definitions.',
  'edit-edit': 'Both branches changed this since they split, in ways that disagree.',
  'modify-delete': '',
};

function ConflictCard({
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
  const tableName =
    schema.tables.find((t) => t.id === conflict.tableId)?.name ?? conflict.tableId;
  const entityName = nameOf(conflict) ?? conflict.entityId;
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
  const base = conflict.base;
  const ours = conflict.ours;
  const theirs = conflict.theirs;

  const rows: { field: string; base: unknown; source: unknown; target: unknown }[] = isScalar
    ? [{ field: 'name', base, source: theirs, target: ours }]
    : fieldsOf([base, ours, theirs]).map((field) => ({
        field,
        base: pick(base, field),
        source: pick(theirs, field),
        target: pick(ours, field),
      }));

  const differing = new Set(conflict.fieldsDiffering ?? []);
  // A modify-delete has no `fieldsDiffering`; the deletion is the difference.
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
          {sourceAbsent || targetAbsent ? (
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
          ) : null}
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
                <td>{base === undefined ? <span className="absent">—</span> : formatValue(r.base)}</td>
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

// ---------- helpers ----------

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
