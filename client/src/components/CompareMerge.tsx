import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type {
  EntityContext,
  MergeResult,
  Resolution,
  ResolutionMap,
  Schema,
  SchemaDiff,
  Violation,
} from '../lib/types';
import type { ResultTable } from '../lib/result';
import { buildResultTables, countChanges, hasDrops, hasRewrites } from '../lib/result';
import { ResultPanel } from './ResultPanel';
import { ConflictCard, rowAnchor } from './ConflictCard';
import {
  IconAlertCircle,
  IconBranch,
  IconChange,
  IconCheck,
  IconCheckCircle,
  IconClose,
  IconMerge,
  IconSwap,
} from './icons';

interface Compared {
  diff: SchemaDiff;
  /** Tip schemas of target and source, for resolving ids to names in the diff. */
  targetSchema: Schema;
  sourceSchema: Schema;
}

/**
 * Diff and merge are the same question asked twice — "what diverged between
 * these two branches, and what do I do about it" — so they're one view rather
 * than two tabs. Comparing is the read-only half; merging acts on it.
 *
 * The sheet reads top to bottom as a verdict: what will happen, the numbers
 * behind it, the decisions still owed, the changes, and finally the shape the
 * target ends up with.
 */
export function CompareMerge({
  repoId,
  repoName,
  branches,
  heads,
  current,
  onClose,
  onMerged,
  onError,
}: {
  repoId: string;
  repoName?: string;
  branches: string[];
  /** Branch name → head commit id, shown as the compared-against revision. */
  heads?: Record<string, string>;
  current: string;
  onClose: () => void;
  onMerged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState(current);
  const [source, setSource] = useState(() => branches.find((b) => b !== current) ?? current);
  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [compared, setCompared] = useState<Compared | null>(null);
  const [preview, setPreview] = useState<MergeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const samePair = source === target;

  // Conflict ids are tied to a specific pair of tips, so switching either side
  // invalidates every decision made so far.
  useEffect(() => {
    setResolutions({});
  }, [source, target]);

  // The read-only half: what `source` would bring into `target`.
  useEffect(() => {
    if (samePair) {
      setCompared(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      api.diff(repoId, target, source),
      api.getSchema(repoId, target),
      api.getSchema(repoId, source),
    ])
      .then(([diff, targetSchema, sourceSchema]) => {
        if (!cancelled) setCompared({ diff, targetSchema, sourceSchema });
      })
      .catch((e: ApiError) => {
        if (!cancelled) {
          setCompared(null);
          onError(e.message);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, source, target]);

  // The merge half — recomputed server-side on every resolution change, so the
  // client never re-implements the merge algorithm.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, source, target, resolutions, samePair]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolve = useCallback((id: string, choice: Resolution) => {
    setResolutions((prev) => ({ ...prev, [id]: choice }));
  }, []);

  /** Puts a decided conflict back in play so the choice can be reconsidered. */
  const unresolve = useCallback((id: string) => {
    setResolutions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const apply = async () => {
    setApplying(true);
    try {
      const result = await api.mergeApply(repoId, source, target, resolutions);
      onMerged(
        result.fastForward
          ? `Fast-forwarded ${target} to ${source}.`
          : `Merged ${source} into ${target}.`
      );
      onClose();
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setApplying(false);
    }
  };

  // `entities` is the stable set of cards for this pair of tips and `conflicts`
  // the shrinking set of what is still owed, so a decided row stays on screen
  // (decisions.md #13) without the client tracking anything itself.
  const cards = preview?.entities ?? [];
  const outstanding = preview?.conflicts.length ?? 0;
  const violations = preview?.validation ?? [];
  const owed = cards.reduce((n, e) => n + decisionsIn(e), 0);
  const decisions = owed - outstanding;
  const canApply =
    Boolean(preview) && outstanding === 0 && violations.length === 0 && !applying && !samePair;

  // Everything the sheet reports comes off this one structure — the target's
  // tables as the merge will leave them — so the summary can never claim a
  // change the panel below doesn't show.
  const tables =
    compared && preview ? buildResultTables(compared.targetSchema, preview.schema) : null;
  const changes = tables ? countChanges(tables) : 0;
  const noChanges = tables !== null && tables.length === 0;
  const identical = Boolean(compared) && countDiffTables(compared!.diff) === 0;
  const blocked = outstanding > 0 || violations.length > 0;
  const tone: Tone = blocked ? 'bad' : 'ok';

  const status = describeStatus({
    samePair,
    tables,
    changes,
    drops: tables ? hasDrops(tables) : false,
    rewrites: tables ? hasRewrites(tables) : false,
    noChanges,
    identical,
    outstanding,
    violations,
    decisions,
    fastForward: Boolean(preview?.fastForward),
    source,
    target,
  });

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={`sheet tone-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-label="Compare and merge branches"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <span className="sheet-mark">
            <IconMerge size={18} />
          </span>
          <div className="sheet-titles">
            <h2>Compare &amp; merge</h2>
            <p className="sheet-sub">{repoName ? `${repoName} · schema review` : 'schema review'}</p>
          </div>
          <span className="spacer" />
          <button className="btn btn-icon btn-quiet" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>

        <div className="sheet-pickers">
          <label className="eyebrow" htmlFor="cm-source">
            Merge from
          </label>
          <span className="branch-pill source">
            <IconBranch size={13} />
            <select
              id="cm-source"
              className="branch-select mono"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </span>

          <button
            className="swap-btn"
            onClick={() => {
              setSource(target);
              setTarget(source);
            }}
            disabled={samePair}
            aria-label="Swap source and target"
            title="Swap source and target"
          >
            <IconSwap size={15} />
          </button>

          <label className="eyebrow" htmlFor="cm-target">
            Into
          </label>
          <span className="branch-pill target">
            <IconBranch size={13} />
            <select
              id="cm-target"
              className="branch-select mono"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </span>
        </div>

        <div className="sheet-body">
          {samePair ? (
            <div className="empty">
              Pick two different branches — <span className="mono">{source}</span> is selected as
              both source and target.
            </div>
          ) : (
            <>
              <div className={`banner ${status.tone}`}>
                <span className="banner-mark">
                  {status.tone === 'bad' ? (
                    <IconAlertCircle size={18} />
                  ) : (
                    <IconCheckCircle size={18} />
                  )}
                </span>
                <div>
                  <div className="banner-title">{status.title}</div>
                  <p>{status.body}</p>
                </div>
              </div>

              <section className="review-card">
                <header className="review-head">
                  <h3>Review summary</h3>
                  <span className={`review-pill ${status.tone}`}>{status.verdict}</span>
                </header>
                <div className="review-stats">
                  <Stat
                    icon={<IconChange size={16} />}
                    value={tables ? String(changes) : '—'}
                    label={changes === 1 ? 'change' : 'changes'}
                  />
                  <Stat
                    icon={<IconAlertCircle size={16} />}
                    value={String(outstanding)}
                    label={outstanding === 1 ? 'field undecided' : 'fields undecided'}
                    tone={outstanding > 0 ? 'bad' : undefined}
                  />
                  <Stat
                    icon={
                      status.metricTone === 'bad' ? (
                        <IconAlertCircle size={16} />
                      ) : (
                        <IconCheck size={16} />
                      )
                    }
                    value={status.metric}
                    label={status.metricLabel}
                    tone={status.metricTone}
                  />
                </div>
              </section>

              {violations.length > 0 && <ValidationProblems violations={violations} />}

              {cards.length > 0 && (
                <section className="sheet-section">
                  <div className="section-title">
                    <h3>Conflicts</h3>
                    <span className="badge">
                      {decisions} of {owed} decided
                    </span>
                  </div>
                  <div className="stack">
                    {cards.map((e) => (
                      <ConflictCard
                        key={e.key}
                        entity={e}
                        schema={preview!.schema}
                        source={source}
                        target={target}
                        resolutions={resolutions}
                        onResolve={resolve}
                        onUnresolve={unresolve}
                        highlightFields={flaggedFields(violations, e)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {!noChanges && (
                <section className="sheet-section">
                  <div className="section-title">
                    <h3>Final schema</h3>
                    <span className="badge">
                      <span className="mono">{target}</span> after merge
                    </span>
                  </div>
                  {tables ? <ResultPanel tables={tables} /> : <div className="empty">Comparing…</div>}
                </section>
              )}

              <div className="sheet-meta">
                <span>
                  Compared against <span className="mono">{target}</span>
                </span>
                <span className="spacer" />
                {heads?.[target] && <span className="mono tiny">{heads[target].slice(0, 7)}</span>}
              </div>
            </>
          )}
        </div>

        <footer className="sheet-foot">
          <span className="muted tiny">
            {samePair
              ? 'Select two different branches.'
              : loading
                ? 'Computing merge…'
                : outstanding > 0
                  ? `${outstanding} undecided${decisions > 0 ? ` · ${decisions} decided` : ''}`
                  : violations.length > 0
                    ? `${violations.length} blocking ${violations.length === 1 ? 'problem' : 'problems'}`
                    : noChanges
                    ? 'Nothing to apply.'
                    : 'Ready to merge.'}
          </span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canApply} onClick={apply}>
            <IconMerge />
            {applying ? 'Merging…' : `Merge into ${target}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** How many decisions a card owes: one per contested field, or one for a delete. */
function decisionsIn(entity: EntityContext): number {
  const fields = Object.values(entity.fields);
  if (fields.length === 0) return 1; // modify-delete is a single whole-entity choice
  return fields.filter((f) => f.status === 'conflict').length;
}

/** Fields on this card that a validation error is pointing at. */
function flaggedFields(violations: Violation[], entity: EntityContext): Set<string> {
  const fields = new Set<string>();
  for (const v of violations) {
    if (v.tableId !== entity.tableId) continue;
    const targetsEntity = v.entityId ? v.entityId === entity.entityId : entity.kind === 'table';
    if (targetsEntity && v.field) fields.add(v.field);
  }
  return fields;
}

/**
 * Mixing fields from two branches can produce something the schema editor would
 * have rejected, so the merged result is checked before it can be applied
 * (decisions.md #17). Each entry jumps to the row whose pick caused it — except
 * where no pick can: two branches that each created an entity of the same name
 * leave nothing to choose between, and the entry says so instead.
 */
function ValidationProblems({ violations }: { violations: Violation[] }) {
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  };

  return (
    // The banner above already says the merge is blocked and why; this section
    // is the list of what to fix, so it doesn't repeat the headline.
    <section className="sheet-section">
      <div className="section-title">
        <h3>What's wrong</h3>
        <span className="badge badge-conflict">
          {violations.length} {violations.length === 1 ? 'problem' : 'problems'}
        </span>
      </div>
      <div>
        <ul className="violation-list">
          {violations.map((v, i) => (
            <li key={`${v.code}-${v.tableId}-${v.entityId ?? ''}-${i}`}>
              <span>{v.message}</span>
              {v.conflictIds.length > 0 ? (
                <button className="btn btn-sm" onClick={() => jump(rowAnchor(v.conflictIds[0]))}>
                  Change the pick
                </button>
              ) : (
                <span className="muted tiny">no pick can fix this</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stat({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tone?: StatTone;
}) {
  return (
    <div className={`rstat ${tone ? `tone-${tone}` : ''}`}>
      <span className="rstat-icon">{icon}</span>
      <span className="rstat-text">
        <span className="rstat-value">{value}</span>
        <span className="rstat-label">{label}</span>
      </span>
    </div>
  );
}

type Tone = 'ok' | 'bad';
type StatTone = 'bad';

interface Status {
  tone: Tone;
  title: string;
  body: ReactNode;
  /** Short pill in the summary header — the verdict in two or three words. */
  verdict: string;
  /** Third summary cell: a headline value and its label. */
  metric: string;
  metricLabel: string;
  metricTone?: StatTone;
}

/**
 * The one place that turns the comparison into a verdict, so the banner, the
 * pill and the third summary cell can never disagree with each other.
 */
function describeStatus({
  samePair,
  tables,
  changes,
  drops,
  rewrites,
  noChanges,
  identical,
  outstanding,
  violations,
  decisions,
  fastForward,
  source,
  target,
}: {
  samePair: boolean;
  tables: ResultTable[] | null;
  changes: number;
  /** The merge takes something away, so the result is worth reading. */
  drops: boolean;
  /** It redefines an existing entity, as against only adding new ones. */
  rewrites: boolean;
  noChanges: boolean;
  /** The branches hold the same schema, as opposed to a merge that no-ops. */
  identical: boolean;
  outstanding: number;
  /** Ways the merged result breaks a rule the schema editor enforces. */
  violations: Violation[];
  decisions: number;
  fastForward: boolean;
  source: string;
  target: string;
}): Status {
  if (outstanding > 0) {
    return {
      tone: 'bad',
      title: `Merge blocked · ${outstanding} ${outstanding === 1 ? 'field' : 'fields'} undecided`,
      body: `Both branches changed the same ${outstanding === 1 ? 'field' : 'fields'} since they split. Everything they changed separately has merged already — decide the rest and the merge can be applied.`,
      verdict: 'decision required',
      metric: 'blocked',
      metricLabel: 'merge status',
      metricTone: 'bad',
    };
  }

  if (violations.length > 0) {
    return {
      tone: 'bad',
      title: 'Merge blocked · result is not valid',
      body: `Every field has been decided, but the combination breaks ${violations.length === 1 ? 'a rule' : 'rules'} the schema editor enforces. Change a pick above to fix it.`,
      verdict: 'invalid result',
      metric: 'blocked',
      metricLabel: 'merge status',
      metricTone: 'bad',
    };
  }

  if (samePair || !tables) {
    return {
      tone: 'ok',
      title: 'Comparing…',
      body: 'Reading both branch tips.',
      verdict: 'working',
      metric: '—',
      metricLabel: 'merge status',
    };
  }

  if (noChanges) {
    return {
      tone: 'ok',
      title: identical ? 'No changes to merge' : 'Nothing left to apply',
      body: identical
        ? 'Both branches already have the same schema. Nothing will be applied.'
        : `Everything on ${source} is already on ${target} or superseded by it, so this merge would leave the schema unchanged.`,
      verdict: 'safe to close',
      metric: '1:1',
      metricLabel: 'snapshot match',
    };
  }

  // What kind of merge this is, stated plainly — a fast-forward moves a
  // pointer, anything else writes a merge commit.
  const metric = fastForward
    ? { metric: 'fast-forward', metricLabel: 'merge type' }
    : { metric: 'merge commit', metricLabel: 'merge type' };

  if (decisions > 0) {
    return {
      tone: 'ok',
      title: 'All conflicts resolved',
      body: `Every conflict has a decision. Applying creates a merge commit on ${target} with two parents.`,
      verdict: 'ready to merge',
      ...metric,
    };
  }

  const noun = `${changes} ${changes === 1 ? 'change' : 'changes'}`;

  return {
    tone: 'ok',
    title: fastForward ? 'Safe to merge · fast-forward' : 'Safe to merge',
    body: fastForward
      ? `${target} hasn't diverged from ${source}, so merging moves its pointer forward. No merge commit is created.`
      : drops
        ? `This applies ${noun} to ${target}, including drops. Check the final schema below before applying.`
        : rewrites
          ? `This applies ${noun} to ${target}, redefining what's already there. Nothing is dropped.`
          : `This applies ${noun} to ${target}, all additions. Nothing already on ${target} is changed or dropped.`,
    verdict: 'no conflicts',
    ...metric,
  };
}

/** Tables the comparison touches at all — "the branches differ", pre-merge. */
function countDiffTables(diff: SchemaDiff): number {
  return diff.tablesAdded.length + diff.tablesRemoved.length + diff.tablesChanged.length;
}
