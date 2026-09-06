import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import type { Commit, Repo, Schema } from './lib/types';
import { shortId } from './lib/format';
import { SchemaEditor } from './components/SchemaEditor';
import { DiffView } from './components/DiffView';
import { MergeView } from './components/MergeView';
import { HistoryView } from './components/HistoryView';
import { ConfirmDialog, Toast } from './components/ui';
import './app.css';

type Tab = 'schema' | 'diff' | 'merge' | 'history';
const TABS: { id: Tab; label: string }[] = [
  { id: 'schema', label: 'Schema' },
  { id: 'diff', label: 'Diff' },
  { id: 'merge', label: 'Merge' },
  { id: 'history', label: 'History' },
];

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branch, setBranch] = useState('main');
  const [schema, setSchema] = useState<Schema>({ tables: [] });
  const [log, setLog] = useState<Commit[]>([]);
  const [tab, setTab] = useState<Tab>('schema');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const onError = useCallback((message: string) => setError(message), []);

  // ---- Initial load ----
  useEffect(() => {
    api
      .listRepos()
      .then((list) => {
        setRepos(list);
        if (list.length) selectRepo(list[0]);
      })
      .catch((e: ApiError) => onError(e.message))
      .finally(() => setBooting(false));
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectRepo(next: Repo) {
    setRepo(next);
    setBranch(next.defaultBranch);
    setTab('schema');
  }

  // ---- Branch content, refetched whenever the repo/branch pair changes ----
  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      const [nextSchema, nextLog, nextRepo] = await Promise.all([
        api.getSchema(repo.id, branch),
        api.getLog(repo.id, branch),
        api.getRepo(repo.id),
      ]);
      setSchema(nextSchema);
      setLog(nextLog);
      setRepo(nextRepo);
    } catch (e) {
      onError((e as ApiError).message);
    }
  }, [repo?.id, branch, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id, branch]);

  // ---- One HTTP call per edit = one commit (LOW_LEVEL_DESIGN.md §6) ----
  const handleOp = useCallback(
    async (op: string, payload: unknown) => {
      if (!repo) return;
      try {
        await api.runOp(repo.id, branch, op, payload);
        await refresh();
      } catch (e) {
        onError((e as ApiError).message);
      }
    },
    [repo?.id, branch, refresh, onError] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const createRepo = async (name: string) => {
    try {
      const created = await api.createRepo(name);
      setRepos((prev) => [...prev, created]);
      selectRepo(created);
    } catch (e) {
      onError((e as ApiError).message);
    }
  };

  const createBranch = async (name: string, from: string) => {
    if (!repo) return;
    try {
      await api.createBranch(repo.id, name, from);
      setRepo(await api.getRepo(repo.id));
      setBranch(name);
      setNotice(`Created branch ${name} from ${from}.`);
    } catch (e) {
      onError((e as ApiError).message);
    }
  };

  const deleteBranch = async (name: string) => {
    if (!repo) return;
    try {
      await api.deleteBranch(repo.id, name);
      const next = await api.getRepo(repo.id);
      setRepo(next);
      if (branch === name) setBranch(next.defaultBranch);
    } catch (e) {
      onError((e as ApiError).message);
    }
  };

  const deleteRepo = async () => {
    if (!repo) return;
    try {
      await api.deleteRepo(repo.id);
      const list = await api.listRepos();
      setRepos(list);
      if (list.length) selectRepo(list[0]);
      else setRepo(null);
    } catch (e) {
      onError((e as ApiError).message);
    }
  };

  const branchNames = repo?.branches.map((b) => b.name) ?? [];

  return (
    <div className="shell">
      <TopBar
        repos={repos}
        repo={repo}
        onSelect={(id) => {
          const next = repos.find((r) => r.id === id);
          if (next) selectRepo(next);
        }}
        onCreate={createRepo}
        onDelete={deleteRepo}
      />

      {!repo ? (
        <Landing booting={booting} onCreate={createRepo} />
      ) : (
        <div className="body">
          <Sidebar
            repo={repo}
            branch={branch}
            onSwitch={setBranch}
            onCreate={createBranch}
            onDelete={deleteBranch}
          />

          <main className="main">
            <nav className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`tab ${tab === t.id ? 'active' : ''}`}
                  aria-current={tab === t.id ? 'page' : undefined}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="content">
              {tab === 'schema' && (
                <SchemaEditor schema={schema} branch={branch} onOp={handleOp} />
              )}
              {tab === 'diff' && (
                <DiffView
                  repoId={repo.id}
                  branches={branchNames}
                  current={branch}
                  onError={onError}
                />
              )}
              {tab === 'merge' && (
                <MergeView
                  repoId={repo.id}
                  branches={branchNames}
                  current={branch}
                  onError={onError}
                  onMerged={(message) => {
                    setNotice(message);
                    void refresh();
                  }}
                />
              )}
              {tab === 'history' && (
                <HistoryView log={log} branch={branch} branches={repo.branches} />
              )}
            </div>
          </main>
        </div>
      )}

      {error && <Toast message={error} onDismiss={() => setError(null)} />}
      {notice && <NoticeToast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}

/** Success counterpart to the error toast; auto-dismisses. */
function NoticeToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3800);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div
      className="toast"
      role="status"
      style={{
        background: 'var(--add-soft)',
        borderColor: 'var(--add-line)',
        color: 'var(--add)',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
    </div>
  );
}

// ---------- Top bar ----------

function TopBar({
  repos,
  repo,
  onSelect,
  onCreate,
  onDelete,
}: {
  repos: Repo[];
  repo: Repo | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const promptNew = () => {
    const name = window.prompt('Name for the new schema repository');
    if (name?.trim()) onCreate(name.trim());
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          Strata <small>schema version control</small>
        </div>

        {repos.length > 0 && (
          <>
            <div className="topbar-sep" />
            <select
              className="select mono"
              aria-label="Repository"
              value={repo?.id ?? ''}
              onChange={(e) => onSelect(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        )}

        <span className="spacer" />

        {repo && (
          <button className="btn btn-sm" onClick={() => setConfirming(true)}>
            Delete repo
          </button>
        )}
        <button className="btn btn-sm" onClick={promptNew}>
          + New repo
        </button>
      </header>

      {confirming && repo && (
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
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

// ---------- Sidebar ----------

function Sidebar({
  repo,
  branch,
  onSwitch,
  onCreate,
  onDelete,
}: {
  repo: Repo;
  branch: string;
  onSwitch: (name: string) => void;
  onCreate: (name: string, from: string) => void;
  onDelete: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), branch);
    setName('');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="eyebrow">Branches</span>
        <span className="badge">{repo.branches.length}</span>
      </div>

      <ul className="branch-list">
        {repo.branches.map((b) => (
          <li key={b.name} className={`branch-item ${b.name === branch ? 'active' : ''}`}>
            <button className="branch-btn" onClick={() => onSwitch(b.name)}>
              <span className="name">
                {b.name}
                {b.name === repo.defaultBranch && ' *'}
              </span>
              <span className="head">{shortId(b.headCommitId)}</span>
            </button>
            {b.name !== repo.defaultBranch && (
              <button
                className="btn btn-sm btn-ghost"
                aria-label={`Delete branch ${b.name}`}
                title="Delete branch"
                onClick={() => setConfirming(b.name)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <form className="sidebar-form" onSubmit={submit}>
        <label className="eyebrow" htmlFor="new-branch">
          New branch from <span className="mono">{branch}</span>
        </label>
        <input
          id="new-branch"
          className="input mono"
          placeholder="add-billing"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!name.trim()}>
          Create branch
        </button>
      </form>

      {confirming && (
        <ConfirmDialog
          title="Delete branch"
          message={
            <>
              Delete <strong className="mono">{confirming}</strong>? Its commits stay on disk, but
              the branch pointer is removed.
            </>
          }
          confirmLabel="Delete branch"
          onConfirm={() => {
            const target = confirming;
            setConfirming(null);
            onDelete(target);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </aside>
  );
}

// ---------- Landing ----------

function Landing({ booting, onCreate }: { booting: boolean; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');

  if (booting) {
    return (
      <div className="landing">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <span className="eyebrow">Get started</span>
        <h2>Create a schema repository</h2>
        <p>
          A repository starts with an empty <span className="mono">main</span> branch. Build a schema
          on it, branch to try something out, then diff and merge the two.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <input
            className="input mono"
            placeholder="billing-db"
            aria-label="Repository name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            Create
          </button>
        </form>
      </div>
    </div>
  );
}
