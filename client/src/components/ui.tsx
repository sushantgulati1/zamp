import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Escape-to-dismiss modal with focus moved to its content on open. */
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Mount only. Keeping this out of the Escape effect below matters: callers
  // routinely pass an inline `onClose`, so that effect re-runs on every parent
  // render — and a re-run here would yank focus out of whatever the user is
  // typing into and back onto the dialog, one character in.
  useEffect(() => {
    const node = ref.current;
    // Don't fight content that has already claimed focus via `autoFocus`.
    if (node && !node.contains(document.activeElement)) node.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Single-field creation dialog, shared by "new repository" and "new branch"
 * so the two can't drift apart. Owns the draft name itself — keeping that state
 * here rather than in each caller is also what stops a caller's inline
 * `onCancel` from being recreated on every keystroke.
 */
export function NameModal({
  title,
  label,
  placeholder,
  description,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder: string;
  description: ReactNode;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const inputId = `name-modal-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <Modal title={title} onClose={onCancel}>
      <p>{description}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <div className="field">
          <label htmlFor={inputId}>{label}</label>
          <input
            id={inputId}
            className="input mono"
            placeholder={placeholder}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Click-to-edit text. Commits on Enter or blur, abandons on Escape.
 * Used for renames, which are the only free-text edits on an existing entity.
 */
export function InlineEdit({
  value,
  onCommit,
  ariaLabel,
  className = '',
  hint = 'edit',
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  className?: string;
  /** Verb used in the tooltip and accessible name, e.g. "rename" for names. */
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  if (!editing) {
    return (
      <button
        className={`editable ${className}`}
        title={`Click to ${hint}`}
        aria-label={`${ariaLabel} (click to ${hint})`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      className={`inline-input ${className}`}
      aria-label={ariaLabel}
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      <button className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
