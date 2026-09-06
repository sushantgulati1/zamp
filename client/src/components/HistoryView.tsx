import type { Branch, Commit } from '../lib/types';
import { formatTime } from '../lib/format';
import { IconBranch } from './icons';

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
    <div className="history-pane">
      <div className="pane-head">
        <div>
          <h3>History</h3>
          <span className="tiny muted">
            {log.length} {log.length === 1 ? 'commit' : 'commits'} reachable from{' '}
            <span className="mono">{branch}</span>
          </span>
        </div>
      </div>

      {log.length === 0 ? (
        <div className="empty">No commits yet.</div>
      ) : (
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
                    <span>{formatTime(c.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {c.schema.tables.length} {c.schema.tables.length === 1 ? 'table' : 'tables'}
                    </span>
                    {isMerge && <span className="badge badge-conflict">merge</span>}
                    {refs.map((r) => (
                      <span key={r} className="ref-chip">
                        <IconBranch size={11} />
                        <span className="mono">{r}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
