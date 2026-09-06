import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateId } from './id.js';
import type { Repo, Branch, Commit, Schema } from './types.js';
import { merge3, type ResolutionMap, type MergeResult } from './merge.js';

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
export class ConflictError extends Error {}

const DATA_DIR = path.join(process.cwd(), 'data');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

interface RepoMeta {
  id: string;
  name: string;
  createdAt: string;
  defaultBranch: string;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    await fs.writeFile(MANIFEST_PATH, '[]');
  }
}

async function readManifest(): Promise<RepoMeta[]> {
  await ensureDataDir();
  const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeManifest(manifest: RepoMeta[]): Promise<void> {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function repoDir(repoId: string): string {
  return path.join(DATA_DIR, 'repos', repoId);
}

function branchesPath(repoId: string): string {
  return path.join(repoDir(repoId), 'branches.json');
}

function commitPath(repoId: string, commitId: string): string {
  return path.join(repoDir(repoId), 'commits', `${commitId}.json`);
}

async function readBranches(repoId: string): Promise<Branch[]> {
  const raw = await fs.readFile(branchesPath(repoId), 'utf-8');
  return JSON.parse(raw);
}

async function writeBranches(repoId: string, branches: Branch[]): Promise<void> {
  await fs.mkdir(repoDir(repoId), { recursive: true });
  await fs.writeFile(branchesPath(repoId), JSON.stringify(branches, null, 2));
}

async function readCommit(repoId: string, commitId: string): Promise<Commit> {
  const raw = await fs.readFile(commitPath(repoId, commitId), 'utf-8');
  return JSON.parse(raw);
}

async function writeCommit(repoId: string, commit: Commit): Promise<void> {
  await fs.mkdir(path.join(repoDir(repoId), 'commits'), { recursive: true });
  await fs.writeFile(commitPath(repoId, commit.id), JSON.stringify(commit, null, 2));
}

async function findRepoMeta(repoId: string): Promise<RepoMeta> {
  const manifest = await readManifest();
  const meta = manifest.find((r) => r.id === repoId);
  if (!meta) throw new NotFoundError(`Repo not found: ${repoId}`);
  return meta;
}

async function findBranch(repoId: string, name: string): Promise<Branch> {
  const branches = await readBranches(repoId);
  const branch = branches.find((b) => b.name === name);
  if (!branch) throw new NotFoundError(`Branch not found: ${name}`);
  return branch;
}

export async function listRepos(): Promise<Repo[]> {
  const manifest = await readManifest();
  const repos: Repo[] = [];
  for (const meta of manifest) {
    const branches = await readBranches(meta.id);
    repos.push({ ...meta, branches });
  }
  return repos;
}

export async function getRepo(repoId: string): Promise<Repo> {
  const meta = await findRepoMeta(repoId);
  const branches = await readBranches(repoId);
  return { ...meta, branches };
}

export async function createRepo(name: string): Promise<Repo> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('Repo name is required');
  const manifest = await readManifest();
  const id = generateId(12);
  const createdAt = new Date().toISOString();
  const defaultBranch = 'main';
  const rootCommit: Commit = {
    id: generateId(),
    parentIds: [],
    message: 'Initial commit',
    schema: { tables: [] },
    createdAt,
  };
  await writeCommit(id, rootCommit);
  const branches: Branch[] = [{ name: defaultBranch, headCommitId: rootCommit.id }];
  await writeBranches(id, branches);
  const meta: RepoMeta = { id, name: trimmed, createdAt, defaultBranch };
  manifest.push(meta);
  await writeManifest(manifest);
  return { ...meta, branches };
}

export async function deleteRepo(repoId: string): Promise<void> {
  await findRepoMeta(repoId);
  const manifest = await readManifest();
  await writeManifest(manifest.filter((r) => r.id !== repoId));
  await fs.rm(repoDir(repoId), { recursive: true, force: true });
}

export async function createBranch(repoId: string, name: string, from: string): Promise<Branch> {
  await findRepoMeta(repoId);
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError('Branch name is required');
  const branches = await readBranches(repoId);
  if (branches.some((b) => b.name === trimmed)) {
    throw new ValidationError(`Branch already exists: ${trimmed}`);
  }
  const source = branches.find((b) => b.name === from);
  if (!source) throw new NotFoundError(`Branch not found: ${from}`);
  const branch: Branch = { name: trimmed, headCommitId: source.headCommitId };
  await writeBranches(repoId, [...branches, branch]);
  return branch;
}

export async function deleteBranch(repoId: string, name: string): Promise<void> {
  const meta = await findRepoMeta(repoId);
  if (name === meta.defaultBranch) {
    throw new ValidationError(`Cannot delete the default branch: ${name}`);
  }
  const branches = await readBranches(repoId);
  if (!branches.some((b) => b.name === name)) throw new NotFoundError(`Branch not found: ${name}`);
  await writeBranches(repoId, branches.filter((b) => b.name !== name));
}

export async function getBranchSchema(repoId: string, branchName: string): Promise<Schema> {
  await findRepoMeta(repoId);
  const branch = await findBranch(repoId, branchName);
  const commit = await readCommit(repoId, branch.headCommitId);
  return commit.schema;
}

export async function getLog(repoId: string, branchName: string): Promise<Commit[]> {
  await findRepoMeta(repoId);
  const branch = await findBranch(repoId, branchName);
  const seen = new Map<string, Commit>();
  const queue = [branch.headCommitId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const commit = await readCommit(repoId, id);
    seen.set(id, commit);
    queue.push(...commit.parentIds);
  }
  return [...seen.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function commitOp(
  repoId: string,
  branchName: string,
  applyOp: (schema: Schema) => Schema,
  message: string | ((before: Schema) => string)
): Promise<Commit> {
  await findRepoMeta(repoId);
  const branch = await findBranch(repoId, branchName);
  const current = await readCommit(repoId, branch.headCommitId);
  const nextSchema = applyOp(current.schema);
  const commit: Commit = {
    id: generateId(),
    parentIds: [branch.headCommitId],
    // Messages that name an entity need the pre-op schema to resolve an id to a
    // name — the entity may not exist any more once the op has been applied.
    message: typeof message === 'function' ? message(current.schema) : message,
    schema: nextSchema,
    createdAt: new Date().toISOString(),
  };
  await writeCommit(repoId, commit);
  const branches = await readBranches(repoId);
  await writeBranches(
    repoId,
    branches.map((b) => (b.name === branchName ? { ...b, headCommitId: commit.id } : b))
  );
  return commit;
}

async function ancestorSet(repoId: string, commitId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const stack = [commitId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = await readCommit(repoId, id);
    stack.push(...commit.parentIds);
  }
  return seen;
}

export async function findMergeBase(repoId: string, commitA: string, commitB: string): Promise<string> {
  const ancestorsOfA = await ancestorSet(repoId, commitA);
  const seen = new Set<string>();
  const queue = [commitB];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (ancestorsOfA.has(id)) return id;
    const commit = await readCommit(repoId, id);
    queue.push(...commit.parentIds);
  }
  throw new ValidationError('No common history between branches');
}

export async function isAncestor(repoId: string, ancestorId: string, descendantId: string): Promise<boolean> {
  const ancestors = await ancestorSet(repoId, descendantId);
  return ancestors.has(ancestorId);
}

export interface MergePreview extends MergeResult {
  fastForward?: boolean;
}

export async function mergeBranches(
  repoId: string,
  source: string,
  target: string,
  resolutions: ResolutionMap,
  apply: boolean
): Promise<{ result: MergePreview; commit?: Commit }> {
  await findRepoMeta(repoId);
  const sourceBranch = await findBranch(repoId, source);
  const targetBranch = await findBranch(repoId, target);

  if (sourceBranch.headCommitId === targetBranch.headCommitId) {
    const schema = await getBranchSchema(repoId, target);
    return { result: { schema, conflicts: [] } };
  }

  if (await isAncestor(repoId, targetBranch.headCommitId, sourceBranch.headCommitId)) {
    const sourceSchema = await getBranchSchema(repoId, source);
    if (apply) {
      const branches = await readBranches(repoId);
      await writeBranches(
        repoId,
        branches.map((b) => (b.name === target ? { ...b, headCommitId: sourceBranch.headCommitId } : b))
      );
    }
    return { result: { schema: sourceSchema, conflicts: [], fastForward: true } };
  }

  const baseCommitId = await findMergeBase(repoId, sourceBranch.headCommitId, targetBranch.headCommitId);
  const [baseCommit, oursCommit, theirsCommit] = await Promise.all([
    readCommit(repoId, baseCommitId),
    readCommit(repoId, targetBranch.headCommitId),
    readCommit(repoId, sourceBranch.headCommitId),
  ]);

  const result = merge3(baseCommit.schema, oursCommit.schema, theirsCommit.schema, resolutions);

  if (!apply) return { result };

  if (result.conflicts.length > 0) {
    throw new ConflictError('Cannot apply merge: unresolved conflicts remain');
  }

  const commit: Commit = {
    id: generateId(),
    parentIds: [targetBranch.headCommitId, sourceBranch.headCommitId],
    message: `Merge ${source} into ${target}`,
    schema: result.schema,
    createdAt: new Date().toISOString(),
  };
  await writeCommit(repoId, commit);
  const branches = await readBranches(repoId);
  await writeBranches(
    repoId,
    branches.map((b) => (b.name === target ? { ...b, headCommitId: commit.id } : b))
  );

  return { result, commit };
}
