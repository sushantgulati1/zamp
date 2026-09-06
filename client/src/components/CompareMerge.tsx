import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Conflict, MergeResult, Resolution, ResolutionMap, Schema, SchemaDiff } from '../lib/types';
import { DiffPanel } from './DiffPanel';
import { ConflictCard } from './ConflictCard';
import { IconArrowRight, IconClose, IconMerge } from './icons';

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
 */
export function CompareMerge({
  repoId,
  branches,
  current,
  onClose,
  onMerged,
  onError,
}: {
  repoId: string;
  branches: string[];
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

  /**
   * Every conflict this pair of tips has surfaced, in first-seen order. The
   * server returns only *unresolved* conflicts, so without this a card would
   * vanish the moment it was decided — see decisions.md #13.
   */
  const [seen, setSeen] = useState<Conflict[]>([]);

  const samePair = source === target;

  // Conflict ids are tied to a specific pair of tips, so switching either side
  // invalidates every decision made so far.
  useEffect(() => {
    setResolutions({});
    setSeen([]);
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

  const outstandingIds = new Set((preview?.conflicts ?? []).map((c) => c.id));
  const cards = seen.filter((c) => outstandingIds.has(c.id) || resolutions[c.id]);
  const outstanding = outstandingIds.size;
  const decisions = cards.filter((c) => resolutions[c.id]).length;
  const canApply = Boolean(preview) && outstanding === 0 && !applying && !samePair;

  const diffTotal = compared
    ? compared.diff.tablesAdded.length +
      compared.diff.tablesRemoved.length +
      compared.diff.tablesChanged.length
    : 0;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Compare and merge branches"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <IconMerge size={17} />
          <h2>Compare &amp; merge</h2>
          <span className="spacer" />
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>

        <div className="sheet-pickers">
          <div className="field">
            <label htmlFor="cm-source">Merge from (source)</label>
            <select
              id="cm-source"
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
          <span className="pick-arrow" aria-hidden="true">
            <IconArrowRight />
          </span>
          <div className="field">
            <label htmlFor="cm-target">Into (target)</label>
            <select
              id="cm-target"
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
          <button
            className="btn btn-sm"
            onClick={() => {
              setSource(target);
              setTarget(source);
            }}
            disabled={samePair}
          >
            Swap
          </button>
        </div>

        <div className="sheet-body">
          {samePair ? (
            <div className="empty">
              Pick two different branches — <span className="mono">{source}</span> is selected as
              both source and target.
            </div>
          ) : (
            <>
              {preview?.fastForward && (
                <div className="banner info">
                  <div>
                    <div className="banner-title">Fast-forward</div>
                    <p>
                      <span className="mono">{target}</span> hasn't diverged from{' '}
                      <span className="mono">{source}</span>, so merging just moves its pointer
                      forward. No merge commit is created.
                    </p>
                  </div>
                </div>
              )}

              {preview && outstanding === 0 && (
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
              )}

              {outstanding > 0 && (
                <div className="banner warn">
                  <div>
                    <div className="banner-title">
                      {outstanding} {outstanding === 1 ? 'conflict needs' : 'conflicts need'} a
                      decision
                    </div>
                    <p>
                      Both branches changed the same thing since they split. Pick which version
                      survives — the merge can't be applied until every one is decided.
                    </p>
                  </div>
                </div>
              )}

              {cards.length > 0 && (
                <section className="sheet-section">
                  <div className="section-title">
                    <h3>Conflicts</h3>
                    <span className="badge">
                      {decisions} of {cards.length} decided
                    </span>
                  </div>
                  <div className="stack">
                    {cards.map((c) => (
                      <ConflictCard
                        key={c.id}
                        conflict={c}
                        schema={preview!.schema}
                        source={source}
                        target={target}
                        choice={resolutions[c.id]}
                        onResolve={resolve}
                        onUnresolve={unresolve}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="sheet-section">
                <div className="section-title">
                  <h3>
                    What <span className="mono">{source}</span> brings into{' '}
                    <span className="mono">{target}</span>
                  </h3>
                  {compared && (
                    <span className="badge">
                      {diffTotal} {diffTotal === 1 ? 'table affected' : 'tables affected'}
                    </span>
                  )}
                </div>
                {!compared ? (
                  <div className="empty">Comparing…</div>
                ) : (
                  <DiffPanel
                    diff={compared.diff}
                    before={compared.targetSchema}
                    after={compared.sourceSchema}
                  />
                )}
              </section>
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
                  ? `${outstanding} unresolved${decisions > 0 ? ` · ${decisions} decided` : ''}`
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
