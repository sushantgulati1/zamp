import { generateId } from './id.js';
import type { Schema, Table, Column, IndexDef, ConstraintDef, ConstraintType } from './types.js';

export class OpError extends Error {}

function findTable(schema: Schema, tableId: string): Table {
  const table = schema.tables.find((t) => t.id === tableId);
  if (!table) throw new OpError(`Table not found: ${tableId}`);
  return table;
}

function replaceTable(schema: Schema, tableId: string, next: Table): Schema {
  return { tables: schema.tables.map((t) => (t.id === tableId ? next : t)) };
}

function findColumn(table: Table, columnId: string): Column {
  const column = table.columns.find((c) => c.id === columnId);
  if (!column) throw new OpError(`Column not found: ${columnId}`);
  return column;
}

function findIndexDef(table: Table, indexId: string): IndexDef {
  const index = table.indexes.find((i) => i.id === indexId);
  if (!index) throw new OpError(`Index not found: ${indexId}`);
  return index;
}

function findConstraint(table: Table, constraintId: string): ConstraintDef {
  const constraint = table.constraints.find((c) => c.id === constraintId);
  if (!constraint) throw new OpError(`Constraint not found: ${constraintId}`);
  return constraint;
}

// ---- Tables ----

export function createTable(schema: Schema, params: { name: string }): Schema {
  const name = params.name.trim();
  if (!name) throw new OpError('Table name is required');
  if (schema.tables.some((t) => t.name === name)) {
    throw new OpError(`Table name already exists: ${name}`);
  }
  const table: Table = { id: generateId(), name, columns: [], indexes: [], constraints: [] };
  return { tables: [...schema.tables, table] };
}

export function dropTable(schema: Schema, params: { tableId: string }): Schema {
  findTable(schema, params.tableId);
  return { tables: schema.tables.filter((t) => t.id !== params.tableId) };
}

export function renameTable(schema: Schema, params: { tableId: string; name: string }): Schema {
  const table = findTable(schema, params.tableId);
  const name = params.name.trim();
  if (!name) throw new OpError('Table name is required');
  if (schema.tables.some((t) => t.id !== params.tableId && t.name === name)) {
    throw new OpError(`Table name already exists: ${name}`);
  }
  return replaceTable(schema, table.id, { ...table, name });
}

// ---- Columns ----

export interface NewColumnInput {
  name: string;
  type: string;
  length?: number;
  nullable?: boolean;
  default?: string;
  primaryKey?: boolean;
}

export function addColumn(schema: Schema, params: { tableId: string; input: NewColumnInput }): Schema {
  const table = findTable(schema, params.tableId);
  const name = params.input.name.trim();
  if (!name) throw new OpError('Column name is required');
  if (!params.input.type?.trim()) throw new OpError('Column type is required');
  if (table.columns.some((c) => c.name === name)) {
    throw new OpError(`Column name already exists: ${name}`);
  }
  const column: Column = {
    id: generateId(),
    name,
    type: params.input.type.trim(),
    length: params.input.length,
    nullable: params.input.nullable ?? true,
    default: params.input.default,
    primaryKey: params.input.primaryKey ?? false,
  };
  return replaceTable(schema, table.id, { ...table, columns: [...table.columns, column] });
}

export function dropColumn(schema: Schema, params: { tableId: string; columnId: string }): Schema {
  const table = findTable(schema, params.tableId);
  findColumn(table, params.columnId);
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.filter((c) => c.id !== params.columnId),
  });
}

export function renameColumn(schema: Schema, params: { tableId: string; columnId: string; name: string }): Schema {
  const table = findTable(schema, params.tableId);
  const column = findColumn(table, params.columnId);
  const name = params.name.trim();
  if (!name) throw new OpError('Column name is required');
  if (table.columns.some((c) => c.id !== column.id && c.name === name)) {
    throw new OpError(`Column name already exists: ${name}`);
  }
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.map((c) => (c.id === column.id ? { ...c, name } : c)),
  });
}

export interface RetypeColumnInput {
  type: string;
  length?: number;
}

export function retypeColumn(
  schema: Schema,
  params: { tableId: string; columnId: string; input: RetypeColumnInput }
): Schema {
  const table = findTable(schema, params.tableId);
  const column = findColumn(table, params.columnId);
  if (!params.input.type?.trim()) throw new OpError('Column type is required');
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.map((c) =>
      c.id === column.id ? { ...c, type: params.input.type.trim(), length: params.input.length } : c
    ),
  });
}

export function setColumnNullable(
  schema: Schema,
  params: { tableId: string; columnId: string; nullable: boolean }
): Schema {
  const table = findTable(schema, params.tableId);
  const column = findColumn(table, params.columnId);
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.map((c) => (c.id === column.id ? { ...c, nullable: params.nullable } : c)),
  });
}

export function setColumnDefault(
  schema: Schema,
  params: { tableId: string; columnId: string; value: string | undefined }
): Schema {
  const table = findTable(schema, params.tableId);
  const column = findColumn(table, params.columnId);
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.map((c) => (c.id === column.id ? { ...c, default: params.value } : c)),
  });
}

export function setColumnPrimaryKey(
  schema: Schema,
  params: { tableId: string; columnId: string; pk: boolean }
): Schema {
  const table = findTable(schema, params.tableId);
  const column = findColumn(table, params.columnId);
  return replaceTable(schema, table.id, {
    ...table,
    columns: table.columns.map((c) => (c.id === column.id ? { ...c, primaryKey: params.pk } : c)),
  });
}

// ---- Indexes ----

export interface NewIndexInput {
  name: string;
  columnIds: string[];
  unique?: boolean;
}

export function addIndex(schema: Schema, params: { tableId: string; input: NewIndexInput }): Schema {
  const table = findTable(schema, params.tableId);
  const name = params.input.name.trim();
  if (!name) throw new OpError('Index name is required');
  if (!params.input.columnIds?.length) throw new OpError('Index requires at least one column');
  for (const columnId of params.input.columnIds) findColumn(table, columnId);
  if (table.indexes.some((i) => i.name === name)) {
    throw new OpError(`Index name already exists: ${name}`);
  }
  const index: IndexDef = {
    id: generateId(),
    name,
    columnIds: params.input.columnIds,
    unique: params.input.unique ?? false,
  };
  return replaceTable(schema, table.id, { ...table, indexes: [...table.indexes, index] });
}

export function dropIndex(schema: Schema, params: { tableId: string; indexId: string }): Schema {
  const table = findTable(schema, params.tableId);
  findIndexDef(table, params.indexId);
  return replaceTable(schema, table.id, {
    ...table,
    indexes: table.indexes.filter((i) => i.id !== params.indexId),
  });
}

// ---- Constraints ----

export interface NewConstraintInput {
  name: string;
  type: ConstraintType;
  definition: string;
  columnIds?: string[];
}

export function addConstraint(schema: Schema, params: { tableId: string; input: NewConstraintInput }): Schema {
  const table = findTable(schema, params.tableId);
  const name = params.input.name.trim();
  if (!name) throw new OpError('Constraint name is required');
  if (!params.input.definition?.trim()) throw new OpError('Constraint definition is required');
  if (table.constraints.some((c) => c.name === name)) {
    throw new OpError(`Constraint name already exists: ${name}`);
  }
  for (const columnId of params.input.columnIds ?? []) findColumn(table, columnId);
  const constraint: ConstraintDef = {
    id: generateId(),
    name,
    type: params.input.type,
    definition: params.input.definition.trim(),
    columnIds: params.input.columnIds,
  };
  return replaceTable(schema, table.id, { ...table, constraints: [...table.constraints, constraint] });
}

export function dropConstraint(schema: Schema, params: { tableId: string; constraintId: string }): Schema {
  const table = findTable(schema, params.tableId);
  findConstraint(table, params.constraintId);
  return replaceTable(schema, table.id, {
    ...table,
    constraints: table.constraints.filter((c) => c.id !== params.constraintId),
  });
}
