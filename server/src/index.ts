import express from 'express';
import cors from 'cors';
import * as ops from './operations.js';
import { OpError } from './operations.js';
import { diffSchemas } from './diff.js';
import type { ResolutionMap } from './merge.js';
import * as store from './store.js';
import { NotFoundError, ValidationError, ConflictError } from './store.js';
import type { Schema } from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

/**
 * One entry per schema-editing operation. Each handler turns a request body into
 * a pure `(schema) => schema` transform plus the commit message that records it.
 * Adding an operation means adding one row here — routes stay untouched.
 */
type OpHandler = (body: any) => {
  apply: (schema: Schema) => Schema;
  /** Resolved against the pre-op schema, so it can name entities the op removes. */
  message: (before: Schema) => string;
};

const tableName = (s: Schema, tableId: string) =>
  s.tables.find((t) => t.id === tableId)?.name ?? 'table';

const columnName = (s: Schema, tableId: string, columnId: string) =>
  s.tables.find((t) => t.id === tableId)?.columns.find((c) => c.id === columnId)?.name ?? 'column';

const indexName = (s: Schema, tableId: string, indexId: string) =>
  s.tables.find((t) => t.id === tableId)?.indexes.find((i) => i.id === indexId)?.name ?? 'index';

const constraintName = (s: Schema, tableId: string, constraintId: string) =>
  s.tables.find((t) => t.id === tableId)?.constraints.find((c) => c.id === constraintId)?.name ?? 'constraint';

/** Qualified `table.column`, the way the commit log reads best. */
const qualified = (s: Schema, tableId: string, columnId: string) =>
  `${tableName(s, tableId)}.${columnName(s, tableId, columnId)}`;

const OP_HANDLERS: Record<string, OpHandler> = {
  createTable: (b) => ({
    apply: (s) => ops.createTable(s, { name: b.name }),
    message: () => `Create table ${b.name}`,
  }),
  dropTable: (b) => ({
    apply: (s) => ops.dropTable(s, { tableId: b.tableId }),
    message: (s) => `Drop table ${tableName(s, b.tableId)}`,
  }),
  renameTable: (b) => ({
    apply: (s) => ops.renameTable(s, { tableId: b.tableId, name: b.name }),
    message: (s) => `Rename table ${tableName(s, b.tableId)} to ${b.name}`,
  }),
  addColumn: (b) => ({
    apply: (s) => ops.addColumn(s, { tableId: b.tableId, input: b.input }),
    message: (s) => `Add column ${tableName(s, b.tableId)}.${b.input?.name}`,
  }),
  dropColumn: (b) => ({
    apply: (s) => ops.dropColumn(s, { tableId: b.tableId, columnId: b.columnId }),
    message: (s) => `Drop column ${qualified(s, b.tableId, b.columnId)}`,
  }),
  renameColumn: (b) => ({
    apply: (s) => ops.renameColumn(s, { tableId: b.tableId, columnId: b.columnId, name: b.name }),
    message: (s) => `Rename column ${qualified(s, b.tableId, b.columnId)} to ${b.name}`,
  }),
  retypeColumn: (b) => ({
    apply: (s) => ops.retypeColumn(s, { tableId: b.tableId, columnId: b.columnId, input: b.input }),
    message: (s) => `Retype ${qualified(s, b.tableId, b.columnId)} to ${b.input?.type}`,
  }),
  setColumnNullable: (b) => ({
    apply: (s) => ops.setColumnNullable(s, { tableId: b.tableId, columnId: b.columnId, nullable: b.nullable }),
    message: (s) =>
      `Make ${qualified(s, b.tableId, b.columnId)} ${b.nullable ? 'nullable' : 'NOT NULL'}`,
  }),
  setColumnDefault: (b) => ({
    apply: (s) => ops.setColumnDefault(s, { tableId: b.tableId, columnId: b.columnId, value: b.value }),
    message: (s) =>
      b.value
        ? `Set default on ${qualified(s, b.tableId, b.columnId)} to ${b.value}`
        : `Clear default on ${qualified(s, b.tableId, b.columnId)}`,
  }),
  setColumnPrimaryKey: (b) => ({
    apply: (s) => ops.setColumnPrimaryKey(s, { tableId: b.tableId, columnId: b.columnId, pk: b.pk }),
    message: (s) =>
      `${b.pk ? 'Add' : 'Remove'} ${qualified(s, b.tableId, b.columnId)} ${b.pk ? 'to' : 'from'} primary key`,
  }),
  addIndex: (b) => ({
    apply: (s) => ops.addIndex(s, { tableId: b.tableId, input: b.input }),
    message: (s) => `Add index ${b.input?.name} on ${tableName(s, b.tableId)}`,
  }),
  dropIndex: (b) => ({
    apply: (s) => ops.dropIndex(s, { tableId: b.tableId, indexId: b.indexId }),
    message: (s) => `Drop index ${indexName(s, b.tableId, b.indexId)}`,
  }),
  addConstraint: (b) => ({
    apply: (s) => ops.addConstraint(s, { tableId: b.tableId, input: b.input }),
    message: (s) => `Add constraint ${b.input?.name} on ${tableName(s, b.tableId)}`,
  }),
  dropConstraint: (b) => ({
    apply: (s) => ops.dropConstraint(s, { tableId: b.tableId, constraintId: b.constraintId }),
    message: (s) => `Drop constraint ${constraintName(s, b.tableId, b.constraintId)}`,
  }),
};

const asyncRoute =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    fn(req, res).catch(next);
  };

// ---- Repos ----

app.get(
  '/api/repos',
  asyncRoute(async (_req, res) => {
    res.json(await store.listRepos());
  })
);

app.post(
  '/api/repos',
  asyncRoute(async (req, res) => {
    res.status(201).json(await store.createRepo(req.body?.name ?? ''));
  })
);

app.get(
  '/api/repos/:repoId',
  asyncRoute(async (req, res) => {
    res.json(await store.getRepo(req.params.repoId));
  })
);

app.delete(
  '/api/repos/:repoId',
  asyncRoute(async (req, res) => {
    await store.deleteRepo(req.params.repoId);
    res.status(204).end();
  })
);

// ---- Branches ----

app.post(
  '/api/repos/:repoId/branches',
  asyncRoute(async (req, res) => {
    const { name, from } = req.body ?? {};
    res.status(201).json(await store.createBranch(req.params.repoId, name ?? '', from ?? 'main'));
  })
);

app.delete(
  '/api/repos/:repoId/branches/:name',
  asyncRoute(async (req, res) => {
    await store.deleteBranch(req.params.repoId, req.params.name);
    res.status(204).end();
  })
);

app.get(
  '/api/repos/:repoId/branches/:name/schema',
  asyncRoute(async (req, res) => {
    res.json(await store.getBranchSchema(req.params.repoId, req.params.name));
  })
);

app.get(
  '/api/repos/:repoId/branches/:name/log',
  asyncRoute(async (req, res) => {
    res.json(await store.getLog(req.params.repoId, req.params.name));
  })
);

// ---- Schema operations ----

app.post(
  '/api/repos/:repoId/branches/:name/ops/:op',
  asyncRoute(async (req, res) => {
    const handler = OP_HANDLERS[req.params.op];
    if (!handler) {
      res.status(400).json({ error: `Unknown operation: ${req.params.op}` });
      return;
    }
    const { apply, message } = handler(req.body ?? {});
    const commit = await store.commitOp(req.params.repoId, req.params.name, apply, message);
    res.status(201).json(commit);
  })
);

// ---- Diff ----

app.get(
  '/api/repos/:repoId/diff',
  asyncRoute(async (req, res) => {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!from || !to) {
      res.status(400).json({ error: 'Both `from` and `to` branches are required' });
      return;
    }
    const [before, after] = await Promise.all([
      store.getBranchSchema(req.params.repoId, from),
      store.getBranchSchema(req.params.repoId, to),
    ]);
    res.json(diffSchemas(before, after));
  })
);

// ---- Merge ----

app.post(
  '/api/repos/:repoId/merge',
  asyncRoute(async (req, res) => {
    const { source, target, resolutions, apply } = req.body ?? {};
    if (!source || !target) {
      res.status(400).json({ error: 'Both `source` and `target` branches are required' });
      return;
    }
    if (source === target) {
      res.status(400).json({ error: 'Cannot merge a branch into itself' });
      return;
    }
    const { result, commit } = await store.mergeBranches(
      req.params.repoId,
      source,
      target,
      (resolutions ?? {}) as ResolutionMap,
      Boolean(apply)
    );
    res.status(commit ? 201 : 200).json({ ...result, commit });
  })
);

// ---- Error translation ----

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof OpError || err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  // A missing commit file surfaces as ENOENT — treat it as a 404 rather than a 500.
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`Graft server listening on http://localhost:${PORT}`);
});
