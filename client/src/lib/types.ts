/**
 * Hand-maintained mirror of the server's `types.ts` / `diff.ts` / `merge.ts`
 * exported shapes. See decisions.md #10 for why this is duplicated rather than
 * shared: keeping it in sync is a manual step, so change both sides together.
 */

export interface Column {
  id: string;
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  default?: string;
  primaryKey: boolean;
}

export interface IndexDef {
  id: string;
  name: string;
  columnIds: string[];
  unique: boolean;
}

export type ConstraintType = 'check' | 'foreign_key' | 'unique';

export interface ConstraintDef {
  id: string;
  name: string;
  type: ConstraintType;
  definition: string;
  columnIds?: string[];
}

export interface Table {
  id: string;
  name: string;
  columns: Column[];
  indexes: IndexDef[];
  constraints: ConstraintDef[];
}

export interface Schema {
  tables: Table[];
}

export interface Branch {
  name: string;
  headCommitId: string;
}

export interface Commit {
  id: string;
  parentIds: string[];
  message: string;
  schema: Schema;
  createdAt: string;
}

export interface Repo {
  id: string;
  name: string;
  branches: Branch[];
  defaultBranch: string;
  createdAt: string;
}

// ---- Diff ----

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export interface EntityDiff<T> {
  added: T[];
  removed: T[];
  modified: { id: string; before: T; after: T; fields: FieldDiff[] }[];
}

export interface TableDiff {
  id: string;
  name?: { from: string; to: string };
  columns: EntityDiff<Column>;
  indexes: EntityDiff<IndexDef>;
  constraints: EntityDiff<ConstraintDef>;
}

export interface SchemaDiff {
  tablesAdded: Table[];
  tablesRemoved: Table[];
  tablesChanged: TableDiff[];
}

// ---- Merge ----

export type ConflictKind = 'table' | 'table-name' | 'column' | 'index' | 'constraint';
export type ConflictReason = 'add-add' | 'edit-edit' | 'modify-delete';

/**
 * `ours` is always the **target** branch and `theirs` the **source** branch —
 * the merge runs as "merge source into target". The UI labels them Source and
 * Target; only this file and the resolution values speak ours/theirs.
 */
export type Resolution = 'ours' | 'theirs' | 'keep' | 'delete';
export type ResolutionMap = Record<string, Resolution>;

export interface Conflict {
  id: string;
  kind: ConflictKind;
  reason: ConflictReason;
  tableId: string;
  entityId: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  deletedSide?: 'ours' | 'theirs';
  fieldsDiffering?: string[];
}

export interface MergeResult {
  schema: Schema;
  conflicts: Conflict[];
  fastForward?: boolean;
  commit?: Commit;
}
