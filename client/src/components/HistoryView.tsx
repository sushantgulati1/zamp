import type { Branch, Commit } from '../lib/types';
import { formatTime, shortId } from '../lib/format';

export function HistoryView({
  log,
  branch,
  branches,
}: {
  log: Commit[];
  branch: string;
  branches: Branch[];
}) {
  const head = branches.find((b) => b.name === branch)?.headCommitId;

  // Which branch tips land on each commit — shown as ref chips, like `git log --decorate`.
  const refsByCommit = new Map<string, string[]>();
  for (const b of branches) {
    refsByCommit.set(b.headCommitId, [...(refsByCommit.get(b.headCommitId) ?? []), b.name]);
  }

  return (
    <div className="content-inner">
      <div className="view-head">
        <div>
          <span className="eyebrow">History</span>
          <h2>
            Commits on <span className="mono">{branch}</span>
          </h2>
          <p>
            Every schema edit is its own commit holding a complete snapshot. Merge commits have two
            parents and are marked accordingly.
          </p>
        </div>
        <span className="badge">
          {log.length} {log.length === 1 ? 'commit' : 'commits'}
        </span>
      </div>

      {log.length === 0 ? (
        <div className="empty">No commits yet.</div>
      ) : (
        <section className="card">
          <div className="card-section">
            <div className="timeline">
              {log.map((c) => {
                const isMerge = c.parentIds.length > 1;
                const refs = refsByCommit.get(c.id) ?? [];
                return (
                  <article
                    key={c.id}
                    className={`commit ${c.id === head ? 'is-head' : ''} ${isMerge ? 'is-merge' : ''}`}
                  >
                    <div className="rail">
                      <span className="node" />
                    </div>
                    <div className="detail">
                      <div className="msg">{c.message}</div>
                      <div className="meta">
                        <span className="sha">{shortId(c.id)}</span>
                        <span>·</span>
                        <span>{formatTime(c.createdAt)}</span>
                        <span>·</span>
                        <span>
                          {c.schema.tables.length}{' '}
                          {c.schema.tables.length === 1 ? 'table' : 'tables'}
                        </span>
                        {isMerge && <span className="badge badge-conflict">merge</span>}
                        {refs.map((r) => (
                          <span key={r} className="badge badge-pk mono">
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
