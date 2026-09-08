import { describe, it, expect } from 'vitest';
import { applyBlockedReason } from '../src/store.js';
import type { Conflict } from '../src/merge.js';
import type { Violation } from '../src/validate.js';

const conflict: Conflict = {
  id: 'column:t1:c1:type',
  kind: 'column',
  reason: 'edit-edit',
  tableId: 't1',
  entityId: 'c1',
  field: 'type',
};

const violation: Violation = {
  code: 'duplicate-column-name',
  message: 'Two columns in this table are named "email".',
  tableId: 't1',
  conflictIds: [],
};

describe('applyBlockedReason', () => {
  it('permits a merge with nothing outstanding', () => {
    expect(applyBlockedReason([], [])).toBeUndefined();
  });

  it('blocks while a conflict is unresolved', () => {
    expect(applyBlockedReason([conflict], [])).toMatch(/unresolved/i);
  });

  it('blocks when the resolved result is invalid, even with no conflicts left', () => {
    const reason = applyBlockedReason([], [violation]);
    expect(reason).toBeDefined();
    expect(reason).toContain('Two columns in this table are named "email".');
  });

  it('reports the conflicts first when both are outstanding', () => {
    expect(applyBlockedReason([conflict], [violation])).toMatch(/unresolved/i);
  });
});
