import { useEffect, useMemo, useRef, useState } from 'react';
import type { Repo } from '../lib/types';
import { ConfirmDialog, NameModal } from './ui';
import { IconBranch, IconChevronDown, IconDatabase, IconDot, IconPlus, IconSearch, IconTrash } from './icons';

/**
 * Branch dots are coloured deterministically from the branch name, so a branch
 * keeps the same colour across sessions and is recognisable at a glance. Purely
 * decorative — the name is always shown next to it.
 */
const DOT_COLORS = ['#3d5a80', '#3f6b45', '#a86d1f', '#7d4f9c', '#2f7f86', '#9a3b34'];

function dotColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DOT_COLORS[hash % DOT_COLORS.length];
}

export function Sidebar({
  repos,
  repo,
  branch,
  onSelectRepo,
  onCreateRepo,
  onDeleteRepo,
  onSwitchBranch,
  onCreateBranch,
  onDeleteBranch,
}: {
  repos: Repo[];
  repo: Repo;
  branch: string;
  onSelectRepo: (id: string) => void;
  onCreateRepo: (name: string) => void;
  onDeleteRepo: () => void;
  onSwitchBranch: (name: string) => void;
  onCreateBranch: (name: string, from: string) => void;
  onDeleteBranch: (name: string) => void;
}) {
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [newRepoOpen, setNewRepoOpen] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [confirmRepo, setConfirmRepo] = useState(false);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the repo menu on an outside click or Escape.
  useEffect(() => {
    if (!repoMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setRepoMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRepoMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [repoMenuOpen]);

  const filteredBranches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repo.branches.filter((b) => b.name.toLowerCase().includes(q)) : repo.branches;
  }, [repo.branches, query]);

  return (
    <aside className="sidebar">
      <section className="side-block">
        <div className="side-head">
          <span className="eyebrow">Repository</span>
        </div>

        <div className="repo-picker" ref={menuRef}>
          <button
            className="repo-card"
            aria-haspopup="listbox"
            aria-expanded={repoMenuOpen}
            onClick={() => setRepoMenuOpen((v) => !v)}
          >
            <span className="repo-icon">
              <IconDatabase />
            </span>
            <span className="repo-text">
              <span className="repo-name">{repo.name}</span>
              <span className="repo-meta">
                {repo.branches.length} {repo.branches.length === 1 ? 'branch' : 'branches'}
              </span>
            </span>
            <IconChevronDown />
          </button>

          {repoMenuOpen && (
            <ul className="menu" role="listbox" aria-label="Switch repository">
              {repos.map((r) => (
                <li key={r.id}>
                  <button
                    className={`menu-item ${r.id === repo.id ? 'active' : ''}`}
                    role="option"
                    aria-selected={r.id === repo.id}
                    onClick={() => {
                      onSelectRepo(r.id);
                      setRepoMenuOpen(false);
                    }}
                  >
                    <IconDatabase />
                    <span className="menu-name">{r.name}</span>
                    <span className="tiny muted">{r.branches.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="repo-actions">
          <button className="btn btn-primary grow" onClick={() => setNewRepoOpen(true)}>
            <IconPlus />
            New repo
          </button>
          <button
            className="btn btn-icon btn-danger-ghost"
            aria-label={`Delete repository ${repo.name}`}
            title="Delete repository"
            onClick={() => setConfirmRepo(true)}
          >
            <IconTrash />
          </button>
        </div>
      </section>

      <section className="side-block grow-block">
        <div className="side-head">
          <IconBranch />
          <span className="eyebrow">Branches</span>
          <span className="badge">{repo.branches.length}</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setNewBranchOpen(true)}>
            <IconPlus />
            New
          </button>
        </div>

        {repo.branches.length > 1 && (
          <div className="search">
            <IconSearch />
            <input
              className="search-input"
              placeholder="Find a branch"
              aria-label="Find a branch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {filteredBranches.length === 0 ? (
          <p className="pane-empty">No branch matches “{query}”.</p>
        ) : (
          <ul className="branch-list">
            {filteredBranches.map((b) => {
              const isCurrent = b.name === branch;
              const isDefault = b.name === repo.defaultBranch;
              return (
                <li key={b.name} className={`branch-item ${isCurrent ? 'active' : ''}`}>
                  <button
                    className="branch-btn"
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => onSwitchBranch(b.name)}
                  >
                    <span className="branch-dot" style={{ color: dotColor(b.name) }}>
                      <IconDot />
                    </span>
                    <span className="branch-text">
                      <span className="branch-name">{b.name}</span>
                      {isDefault && <span className="branch-sub">Default branch</span>}
                    </span>
                    {isCurrent && <span className="badge badge-current">current</span>}
                  </button>
                  {!isDefault && (
                    <button
                      className="btn btn-sm btn-icon btn-ghost branch-del"
                      aria-label={`Delete branch ${b.name}`}
                      title={`Delete branch ${b.name}`}
                      onClick={() => setConfirmBranch(b.name)}
                    >
                      <IconTrash />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="side-tip">
          Branches are isolated schema timelines. Changes stay on a branch until you merge them.
        </p>
      </section>

      {newRepoOpen && (
        <NameModal
          title="New repository"
          label="Repository name"
          placeholder="billing-db"
          description="Starts with an empty main branch."
          confirmLabel="Create repository"
          onSubmit={(name) => {
            setNewRepoOpen(false);
            onCreateRepo(name);
          }}
          onCancel={() => setNewRepoOpen(false)}
        />
      )}

      {newBranchOpen && (
        <NameModal
          title="New branch"
          label="Branch name"
          placeholder="add-billing"
          description={
            <>
              Branches from <strong className="mono">{branch}</strong>, copying its current schema.
              The two then diverge independently.
            </>
          }
          confirmLabel="Create branch"
          onSubmit={(name) => {
            setNewBranchOpen(false);
            onCreateBranch(name, branch);
          }}
          onCancel={() => setNewBranchOpen(false)}
        />
      )}

      {confirmRepo && (
        <ConfirmDialog
          title="Delete repository"
          message={
            <>
              Permanently delete <strong className="mono">{repo.name}</strong>, including every
              branch and all commit history? This cannot be undone.
            </>
          }
          confirmLabel="Delete repository"
          onConfirm={() => {
            setConfirmRepo(false);
            onDeleteRepo();
          }}
          onCancel={() => setConfirmRepo(false)}
        />
      )}

      {confirmBranch && (
        <ConfirmDialog
          title="Delete branch"
          message={
            <>
              Delete <strong className="mono">{confirmBranch}</strong>? Its commits stay on disk,
              but the branch pointer is removed.
            </>
          }
          confirmLabel="Delete branch"
          onConfirm={() => {
            const target = confirmBranch;
            setConfirmBranch(null);
            onDeleteBranch(target);
          }}
          onCancel={() => setConfirmBranch(null)}
        />
      )}
    </aside>
  );
}
