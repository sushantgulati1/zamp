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
