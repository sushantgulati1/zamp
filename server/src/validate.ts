import type { Schema, Table } from './types.js';
import type { Provenance } from './merge.js';

export type ViolationCode =
  | 'duplicate-table-name'
  | 'duplicate-column-name'
  | 'duplicate-index-name'
  | 'duplicate-constraint-name'
  | 'empty-name'
  | 'empty-type'
  | 'empty-definition'
  | 'index-no-columns'
  | 'dangling-column-ref';

export interface Violation {
  code: ViolationCode;
  message: string;
  tableId: string;
  entityId?: string;
  field?: string;
  /** Field conflicts whose picks produced this value. Empty = no pick can fix it. */
  conflictIds: string[];
}

/**
 * Checks a merged schema against the invariants `operations.ts` already upholds —
 * and *only* those. Field-level resolution can combine two sides into an entity
 * neither branch had, and this is what keeps that safe (decisions.md #5, #17).
 *
 * The restriction matters: any rule beyond what the schema editor enforces could
 * block a merge over a state each branch was independently allowed to reach, with
 * nothing in the merge screen able to fix it. Notably `primaryKey` does not imply
 * `!nullable` here, because `setColumnPrimaryKey` does not require it either.
 */
export function validate(schema: Schema, provenance: Provenance): Violation[] {
  const violations: Violation[] = [];
  const at = (tableId: string, entityId: string, field: string) =>
    provenance[`${tableId}:${entityId}:${field}`];

  /** Groups entities by name, returning only the names more than one entity claims. */
  function collisions<T extends { id: string; name: string }>(entities: T[]): [string, T[]][] {
    const byName = new Map<string, T[]>();
    for (const e of entities) {
      const group = byName.get(e.name) ?? [];
      group.push(e);
      byName.set(e.name, group);
    }
    return [...byName].filter(([, group]) => group.length > 1);
  }

  /** One violation per colliding name group, carrying every pick that fed it. */
  function checkUniqueNames(
    code: ViolationCode,
    label: string,
    tableId: string,
    entities: { id: string; name: string }[]
  ): void {
    for (const [name, group] of collisions(entities)) {
      violations.push({
        code,
        message: `Two ${label} in this table are named "${name}". Names have to be unique within a table.`,
        tableId,
        entityId: group[0].id,
        field: 'name',
        conflictIds: group.map((e) => at(tableId, e.id, 'name')).filter((c): c is string => !!c),
      });
    }
  }

  /**
   * Table names are checked apart from the helper above: a table is its own
   * `tableId`, so each colliding table has to be looked up under its own id
   * rather than the group's anchor.
   */
  function checkUniqueTableNames(tables: Table[]): void {
    for (const [name, group] of collisions(tables)) {
      violations.push({
        code: 'duplicate-table-name',
        message: `Two tables are named "${name}". Each branch created its own, so there is no version to pick between — rename one of them on a branch, then merge.`,
        tableId: group[0].id,
        field: 'name',
        conflictIds: group.map((t) => at(t.id, t.id, 'name')).filter((c): c is string => !!c),
      });
    }
  }

  function checkName(code: ViolationCode, label: string, tableId: string, entity: { id: string; name: string }): void {
    if (entity.name.trim()) return;
    violations.push({
      code: 'empty-name',
      message: `A ${label} has no name.`,
      tableId,
      entityId: entity.id,
      field: 'name',
      conflictIds: [at(tableId, entity.id, 'name')].filter((c): c is string => !!c),
    });
  }

  function checkTable(table: Table): void {
    checkName('empty-name', 'table', table.id, table);
    checkUniqueNames('duplicate-column-name', 'columns', table.id, table.columns);
    checkUniqueNames('duplicate-index-name', 'indexes', table.id, table.indexes);
    checkUniqueNames('duplicate-constraint-name', 'constraints', table.id, table.constraints);

    const columnIds = new Set(table.columns.map((c) => c.id));

    for (const column of table.columns) {
      checkName('empty-name', 'column', table.id, column);
      if (!column.type.trim()) {
        violations.push({
          code: 'empty-type',
          message: `Column "${column.name}" has no type.`,
          tableId: table.id,
          entityId: column.id,
          field: 'type',
          conflictIds: [at(table.id, column.id, 'type')].filter((c): c is string => !!c),
        });
      }
    }

    for (const index of table.indexes) {
      checkName('empty-name', 'index', table.id, index);
      if (index.columnIds.length === 0) {
        violations.push({
          code: 'index-no-columns',
          message: `Index "${index.name}" covers no columns.`,
          tableId: table.id,
          entityId: index.id,
          field: 'columnIds',
          conflictIds: [at(table.id, index.id, 'columnIds')].filter((c): c is string => !!c),
        });
      }
      checkColumnRefs(table, index.id, `Index "${index.name}"`, index.columnIds, columnIds);
    }

    for (const constraint of table.constraints) {
      checkName('empty-name', 'constraint', table.id, constraint);
      if (!constraint.definition.trim()) {
        violations.push({
          code: 'empty-definition',
          message: `Constraint "${constraint.name}" has no definition.`,
          tableId: table.id,
          entityId: constraint.id,
          field: 'definition',
          conflictIds: [at(table.id, constraint.id, 'definition')].filter((c): c is string => !!c),
        });
      }
      checkColumnRefs(table, constraint.id, `Constraint "${constraint.name}"`, constraint.columnIds ?? [], columnIds);
    }
  }

  /** An index or constraint can outlive the column it covers when only one side dropped it. */
  function checkColumnRefs(
    table: Table,
    entityId: string,
    label: string,
    refs: string[],
    columnIds: Set<string>
  ): void {
    const missing = refs.filter((id) => !columnIds.has(id));
    if (missing.length === 0) return;
    violations.push({
      code: 'dangling-column-ref',
      message: `${label} covers ${missing.length === 1 ? 'a column' : 'columns'} that no longer exist${
        missing.length === 1 ? 's' : ''
      } on "${table.name}".`,
      tableId: table.id,
      entityId,
      field: 'columnIds',
      conflictIds: [at(table.id, entityId, 'columnIds')].filter((c): c is string => !!c),
    });
  }

  checkUniqueTableNames(schema.tables);
  for (const table of schema.tables) checkTable(table);

  return violations;
}
