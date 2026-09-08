import type { EntityContext, FieldStatus, Resolution, ResolutionMap, Schema } from '../lib/types';
import { fieldLabel } from '../lib/format';
import { columnNamer, formatField } from '../lib/describe';
import { IconBranch, IconCheck, IconHistory, IconWarning } from './icons';

/**
 * The merge engine speaks ours/theirs; the UI speaks Target/Source.
 * `ours` is always the target branch (merged into) and `theirs` the source.
 * That mapping lives here and in `lib/types.ts` — nowhere else.
 *
 * One card per *entity*, not per conflict: a column whose type and default both
 * clash is one card with two decisions. The Base/Source/Target table is the
 * control (decisions.md #12) — each contested field is decided on its own row,
 * and the fields that merged by themselves stay visible, muted, with the reason
 * they settled. Those rows are the point: they show that most of the entity
 * merged without help, which is what field-level resolution buys (#5).
 */

/** Whole-entity keep/delete is the only decision that isn't a field (#6). */
function isModifyDelete(entity: EntityContext): boolean {
  return Object.keys(entity.fields).length === 0;
}

export function ConflictCard({
  entity,
  schema,
  source,
  target,
  resolutions,
  onResolve,
  onUnresolve,
  highlightFields,
}: {
  entity: EntityContext;
  schema: Schema;
  source: string;
  target: string;
  resolutions: ResolutionMap;
  onResolve: (id: string, choice: Resolution) => void;
  onUnresolve: (id: string) => void;
  /** Field names a validation error is pointing at, for the jump-to-row link. */
  highlightFields?: Set<string>;
}) {
  const path =
    entity.kind === 'table' ? entity.tableName : `${entity.tableName}.${entity.entityName}`;

  if (isModifyDelete(entity)) {
    return (
      <DeleteCard
        entity={entity}
        path={path}
        source={source}
        target={target}
        choice={resolutions[entity.key]}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />
    );
  }

  const rows = Object.entries(entity.fields);
  const contested = rows.filter(([, s]) => s.status === 'conflict');
  const decided = contested.filter(([, s]) => resolutions[(s as { conflictId: string }).conflictId]);
  const settled = decided.length === contested.length;

  const table = schema.tables.find((t) => t.id === entity.tableId);
  const namer = columnNamer(table);

  return (
    <section id={cardAnchor(entity.key)} className={`conflict-card ${settled ? 'resolved' : ''}`}>
      <header className="conflict-head">
        <span className={`badge ${settled ? 'badge-add' : 'badge-conflict'}`}>
          {settled ? 'resolved' : entity.kind}
        </span>
        <span className="conflict-path mono">{path}</span>
        <span className="spacer" />
        <span className="conflict-note">
          <IconHistory size={13} />
          {decided.length} of {contested.length} decided
        </span>
      </header>

      <div className="conflict-body">
        <div className={`conflict-hint ${settled ? 'ok' : ''}`}>
          {settled ? <IconCheck size={14} /> : <IconWarning size={14} />}
          <span>
            {settled
              ? 'Every contested field has a decision.'
              : `${contested.length === 1 ? 'One field' : `${contested.length} fields`} changed on both branches. Everything else merged on its own.`}
          </span>
        </div>

        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th className="field">Field</th>
                <th>Base</th>
                <th className="pick">Source · {source}</th>
                <th className="pick">Target · {target}</th>
                <th className="decide">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([field, status]) => (
                <FieldRow
                  key={field}
                  field={field}
                  status={status}
                  base={valueAt(entity.base, field)}
                  sourceValue={valueAt(entity.theirs, field)}
                  targetValue={valueAt(entity.ours, field)}
                  hasBase={entity.base !== undefined}
                  choice={
                    status.status === 'conflict' ? resolutions[status.conflictId] : undefined
                  }
                  flagged={highlightFields?.has(field) ?? false}
                  namer={namer}
                  onResolve={onResolve}
                  onUnresolve={onUnresolve}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const AUTO_NOTE: Record<'converged' | 'ours' | 'theirs', string> = {
  converged: 'both agree',
  ours: 'only target changed',
  theirs: 'only source changed',
};

function FieldRow({
  field,
  status,
  base,
  sourceValue,
  targetValue,
  hasBase,
  choice,
  flagged,
  namer,
  onResolve,
  onUnresolve,
}: {
  field: string;
  status: FieldStatus;
  base: unknown;
  sourceValue: unknown;
  targetValue: unknown;
  hasBase: boolean;
  choice?: Resolution;
  flagged: boolean;
  namer: (id: string) => string;
  onResolve: (id: string, choice: Resolution) => void;
  onUnresolve: (id: string) => void;
}) {
  const show = (v: unknown) => formatField(field, v, namer);
  const auto = status.status === 'auto';
  const sourceChosen = choice === 'theirs';
  const targetChosen = choice === 'ours';

  return (
    <tr
      id={auto ? undefined : rowAnchor(status.conflictId)}
      className={`${auto ? 'same' : 'differs'} ${flagged ? 'flagged' : ''}`}
    >
      <td className="field">{fieldLabel(field)}</td>
      <td>{hasBase ? show(base) : <span className="absent">—</span>}</td>
      <td className={sourceChosen ? 'chosen' : ''}>{show(sourceValue)}</td>
      <td className={targetChosen ? 'chosen' : ''}>{show(targetValue)}</td>
      <td className="decide">
        {auto ? (
          <span className="auto-note">
            <IconCheck size={11} />
            {AUTO_NOTE[status.won]}
          </span>
        ) : choice ? (
          <span className="row-decided">
            kept {sourceChosen ? 'source' : 'target'}
            <button className="btn btn-sm" onClick={() => onUnresolve(status.conflictId)}>
              Undo
            </button>
          </span>
        ) : (
          <span className="row-picks">
            <button
              className="btn btn-sm pick-source"
              onClick={() => onResolve(status.conflictId, 'theirs')}
            >
              Source
            </button>
            <button
              className="btn btn-sm pick-target"
              onClick={() => onResolve(status.conflictId, 'ours')}
            >
              Target
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * One side deleted what the other modified. There is no field to scope this to,
 * so it stays a whole-entity choice: keep the edited version, or confirm the
 * delete (decisions.md #6).
 */
function DeleteCard({
  entity,
  path,
  source,
  target,
  choice,
  onResolve,
  onUnresolve,
}: {
  entity: EntityContext;
  path: string;
  source: string;
  target: string;
  choice?: Resolution;
  onResolve: (id: string, choice: Resolution) => void;
  onUnresolve: (id: string) => void;
}) {
  const sourceAbsent = entity.theirs === undefined;
  const targetAbsent = entity.ours === undefined;
  const deletedBranch = targetAbsent ? target : source;
  const keptBranch = targetAbsent ? source : target;

  // Which button means "keep" and which means "delete" depends on which side
  // still has the entity, so the label always describes the outcome.
  const sourceChoice: Resolution = sourceAbsent ? 'delete' : 'keep';
  const targetChoice: Resolution = targetAbsent ? 'delete' : 'keep';
  const sourcePicked = choice !== undefined && choice === sourceChoice;
  const targetPicked = choice !== undefined && choice === targetChoice;

  return (
    <section id={cardAnchor(entity.key)} className={`conflict-card ${choice ? 'resolved' : ''}`}>
      <header className="conflict-head">
        <span className={`badge ${choice ? 'badge-add' : 'badge-conflict'}`}>
          {choice ? 'resolved' : 'modify / delete'}
        </span>
        <span className="conflict-path mono">{path}</span>
        <span className="spacer" />
        <span className="conflict-note">
          <IconHistory size={13} />
          deleted on one branch
        </span>
        {choice && (
          <button className="btn btn-sm" onClick={() => onUnresolve(entity.key)}>
            Undo
          </button>
        )}
      </header>

      <div className="conflict-body">
        <div className={`conflict-hint ${choice ? 'ok' : ''}`}>
          {choice ? <IconCheck size={14} /> : <IconWarning size={14} />}
          <span>
            {choice
              ? `Keeping the ${sourcePicked ? 'source' : 'target'} version${
                  choice === 'delete' ? ' — this will be dropped' : ''
                }.`
              : 'Pick one. The merge stays blocked until this is decided.'}
          </span>
        </div>

        <div className="choice-grid">
          <ChoiceCard
            side="source"
            branch={source}
            picked={sourcePicked}
            dimmed={choice !== undefined && !sourcePicked}
            absent={sourceAbsent}
            name={entity.entityName}
            onPick={() => onResolve(entity.key, sourceChoice)}
          />
          <ChoiceCard
            side="target"
            branch={target}
            picked={targetPicked}
            dimmed={choice !== undefined && !targetPicked}
            absent={targetAbsent}
            name={entity.entityName}
            onPick={() => onResolve(entity.key, targetChoice)}
          />
        </div>

        <p className="conflict-why">
          <span className="mono">{deletedBranch}</span> deleted this, while{' '}
          <span className="mono">{keptBranch}</span> modified it. There's no safe default here —
          either choice discards someone's work, so it's yours to make.
        </p>
      </div>
    </section>
  );
}

function ChoiceCard({
  side,
  branch,
  picked,
  dimmed,
  absent,
  name,
  onPick,
}: {
  side: 'source' | 'target';
  branch: string;
  picked: boolean;
  dimmed: boolean;
  absent: boolean;
  name: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`choice ${side} ${picked ? 'picked' : ''} ${dimmed ? 'dimmed' : ''}`}
      aria-pressed={picked}
      onClick={onPick}
    >
      <span className="choice-side">
        <IconBranch size={12} />
        {side} · {branch}
        {picked && <IconCheck size={13} className="choice-tick" />}
      </span>
      <span className={`choice-value mono ${absent ? 'absent' : ''}`}>
        {absent ? 'deleted' : name}
      </span>
      <span className="choice-act">{absent ? 'Accept the delete' : `Keep ${side} version`}</span>
    </button>
  );
}

function valueAt(side: unknown, field: string): unknown {
  return side && typeof side === 'object' ? (side as Record<string, unknown>)[field] : undefined;
}

/** Anchors the validation banner links jump to. */
export function cardAnchor(key: string): string {
  return `conflict-${key.replace(/[^\w-]/g, '_')}`;
}

export function rowAnchor(conflictId: string): string {
  return `row-${conflictId.replace(/[^\w-]/g, '_')}`;
}
