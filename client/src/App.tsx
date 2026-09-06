import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import type { Commit, Repo, Schema } from './lib/types';
import { Sidebar } from './components/Sidebar';
import { SchemaEditor } from './components/SchemaEditor';
import { HistoryView } from './components/HistoryView';
import { CompareMerge } from './components/CompareMerge';
import { Modal, Toast } from './components/ui';
import {
  IconChevronRight,
  IconHistory,
  IconLogo,
  IconMerge,
  IconSchema,
} from './components/icons';
import './app.css';

type Tab = 'schema' | 'history';

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branch, setBranch] = useState('main');
  const [schema, setSchema] = useState<Schema>({ tables: [] });
  const [log, setLog] = useState<Commit[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('schema');
  const [compareOpen, setCompareOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const onError = useCallback((message: string) => setError(message), []);

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
    setSelectedTableId(null);
  }

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

  // Keep a table selected whenever there is one to select: default to the first,
  // and fall back if the selected table no longer exists on this branch.
  useEffect(() => {
    if (schema.tables.length === 0) {
      setSelectedTableId(null);
      return;
    }
    setSelectedTableId((current) =>
      current && schema.tables.some((t) => t.id === current) ? current : schema.tables[0].id
    );
  }, [schema]);

  // One HTTP call per edit = one commit (LOW_LEVEL_DESIGN.md §6).
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

  const branchNames = repo?.branches.map((b) => b.name) ?? [];
  const isDefault = repo ? branch === repo.defaultBranch : false;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <IconLogo />
          </span>
          <span className="brand-text">
            <span className="brand-name">Graft</span>
            <span className="brand-sub">Schema control</span>
          </span>
        </div>
        {repo && (
          <>
            <span className="topbar-sep" />
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className="crumb muted">Workspace</span>
              <IconChevronRight size={13} />
              <span className="crumb current mono">{repo.name}</span>
            </nav>
          </>
        )}
      </header>

      {!repo ? (
        <Landing booting={booting} onCreate={createRepo} />
      ) : (
        <div className="body">
          <Sidebar
            repos={repos}
            repo={repo}
            branch={branch}
            onSelectRepo={(id) => {
              const next = repos.find((r) => r.id === id);
              if (next) selectRepo(next);
            }}
            onCreateRepo={createRepo}
            onDeleteRepo={deleteRepo}
            onSwitchBranch={setBranch}
            onCreateBranch={createBranch}
            onDeleteBranch={deleteBranch}
          />

          <main className="main">
            <div className="main-head">
              <nav className="crumbs" aria-label="Breadcrumb">
                <span className="crumb muted mono">{repo.name}</span>
                <IconChevronRight size={13} />
                <span className="crumb muted">branches</span>
                <IconChevronRight size={13} />
                <span className="crumb current mono">{branch}</span>
              </nav>

              <div className="title-row">
                <h1 className="mono">{branch}</h1>
                {isDefault && <span className="badge badge-pk">default</span>}
                <span className="spacer" />
                <button
                  className="btn btn-primary"
                  onClick={() => setCompareOpen(true)}
                  disabled={branchNames.length < 2}
                  title={
                    branchNames.length < 2
                      ? 'Create a second branch to compare against'
                      : 'Compare and merge branches'
                  }
                >
                  <IconMerge />
                  Compare &amp; merge
                </button>
              </div>

              <p className="title-meta">
                {schema.tables.length} {schema.tables.length === 1 ? 'table' : 'tables'}
                <span aria-hidden="true"> · </span>
                {log.length} {log.length === 1 ? 'commit' : 'commits'}
              </p>

              <nav className="tabs">
                <button
                  className={`tab ${tab === 'schema' ? 'active' : ''}`}
                  aria-current={tab === 'schema' ? 'page' : undefined}
                  onClick={() => setTab('schema')}
                >
                  <IconSchema />
                  Schema
                </button>
                <button
                  className={`tab ${tab === 'history' ? 'active' : ''}`}
                  aria-current={tab === 'history' ? 'page' : undefined}
                  onClick={() => setTab('history')}
                >
                  <IconHistory />
                  History
                </button>
              </nav>
            </div>

            <div className="content">
              {tab === 'schema' ? (
                <SchemaEditor
                  schema={schema}
                  branch={branch}
                  selectedTableId={selectedTableId}
                  onSelectTable={setSelectedTableId}
                  onOp={handleOp}
                />
              ) : (
                <HistoryView log={log} branch={branch} branches={repo.branches} />
              )}
            </div>
          </main>
        </div>
      )}

      {compareOpen && repo && (
        <CompareMerge
          repoId={repo.id}
          branches={branchNames}
          current={branch}
          onClose={() => setCompareOpen(false)}
          onError={onError}
          onMerged={(message) => {
            setNotice(message);
            void refresh();
          }}
        />
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
    <div className="toast toast-ok" role="status">
      <span className="grow">{message}</span>
    </div>
  );
}

function Landing({ booting, onCreate }: { booting: boolean; onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
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
        <span className="landing-mark">
          <IconLogo size={34} />
        </span>
        <h2>Create a schema repository</h2>
        <p>
          A repository starts with an empty <span className="mono">main</span> branch. Build a
          schema on it, branch to try something out, then compare and merge the two.
        </p>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Create repository
        </button>
      </div>

      {open && (
        <Modal title="New repository" onClose={() => setOpen(false)}>
          <p>
            Starts with an empty <span className="mono">main</span> branch.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                setOpen(false);
                onCreate(name.trim());
              }
            }}
          >
            <div className="field">
              <label htmlFor="landing-repo-name">Repository name</label>
              <input
                id="landing-repo-name"
                className="input mono"
                placeholder="billing-db"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
                Create repository
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
