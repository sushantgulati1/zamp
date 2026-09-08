import type {
  Branch,
  Commit,
  MergeResult,
  Repo,
  ResolutionMap,
  Schema,
  SchemaDiff,
} from './types';

/** Carries the server's `{ error }` message so the UI can show it verbatim. */
export class ApiError extends Error {
  // Declared explicitly rather than as a constructor parameter property, which
  // the client's `erasableSyntaxOnly` TS config disallows.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Same-origin `/api` in dev (proxied by Vite) and whenever the client is served
// from the same domain as the API. Set VITE_API_URL when the API lives on a
// different origin, e.g. a separate Render service behind its own subdomain.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running on port 4000?', 0);
  }

  if (!res.ok) {
    // Error bodies are `{ error }`, but a proxy or crash can return HTML instead.
    const message = await res
      .json()
      .then((b) => b?.error as string)
      .catch(() => null);
    throw new ApiError(message || `Request failed (${res.status})`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const body = (data: unknown) => ({ method: 'POST', body: JSON.stringify(data) });

export const api = {
  listRepos: () => request<Repo[]>('/repos'),

  createRepo: (name: string) => request<Repo>('/repos', body({ name })),

  getRepo: (repoId: string) => request<Repo>(`/repos/${repoId}`),

  deleteRepo: (repoId: string) => request<void>(`/repos/${repoId}`, { method: 'DELETE' }),

  createBranch: (repoId: string, name: string, from: string) =>
    request<Branch>(`/repos/${repoId}/branches`, body({ name, from })),

  deleteBranch: (repoId: string, name: string) =>
    request<void>(`/repos/${repoId}/branches/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  getSchema: (repoId: string, branch: string) =>
    request<Schema>(`/repos/${repoId}/branches/${encodeURIComponent(branch)}/schema`),

  getLog: (repoId: string, branch: string) =>
    request<Commit[]>(`/repos/${repoId}/branches/${encodeURIComponent(branch)}/log`),

  runOp: (repoId: string, branch: string, op: string, payload: unknown) =>
    request<Commit>(
      `/repos/${repoId}/branches/${encodeURIComponent(branch)}/ops/${op}`,
      body(payload)
    ),

  diff: (repoId: string, from: string, to: string) =>
    request<SchemaDiff>(
      `/repos/${repoId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),

  /** Server-side merge computation with `apply: false` — the client never re-implements merge. */
  mergePreview: (repoId: string, source: string, target: string, resolutions: ResolutionMap) =>
    request<MergeResult>(`/repos/${repoId}/merge`, body({ source, target, resolutions })),

  mergeApply: (repoId: string, source: string, target: string, resolutions: ResolutionMap) =>
    request<MergeResult>(`/repos/${repoId}/merge`, body({ source, target, resolutions, apply: true })),
};
