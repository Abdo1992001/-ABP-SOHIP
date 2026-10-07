import { useEffect, useRef, useState } from "react";

/**
 * Choosing what the offer is for.
 *
 * Nearly every ABP offer is for ACROW Board, and the few that are not still
 * repeat: a subject typed fresh each time gives an archive holding "ACROW
 * Board", "Acrow board" and "ACROW BOARDS" as three different things, and
 * nothing can then be grouped or counted by subject. So it is a list with one
 * default already selected.
 *
 * The plus button is the other half of the same requirement. A closed list
 * would send the one person who needs a new subject to an administrator, and
 * what they would actually do is type the document in a spreadsheet instead —
 * which is the habit this system exists to replace. So anyone writing an offer
 * can add a subject, once, and it is then on the list for everybody.
 *
 * A subject already saved on this quotation is always offered even when it is
 * no longer on the list. Silently moving an issued document's subject to
 * whatever happens to be first is worse than showing a retired one.
 */

export function SubjectPicker({
  value,
  options,
  editable,
  labels,
  onChange,
  onAdd,
}: {
  value: string;
  options: readonly string[];
  editable: boolean;
  labels: {
    field: string;
    notSet: string;
    add: string;
    addTitle: string;
    addHint: string;
    subject: string;
    save: string;
    cancel: string;
    saving: string;
    failed: string;
  };
  onChange: (value: string) => void;
  /** Resolves with the subject as stored, which the picker then selects. */
  onAdd: (text: string) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);

  if (!editable) return <>{value || "—"}</>;

  // The saved subject first when the list no longer carries it, so a document
  // that already says something keeps saying it.
  const choices =
    value !== "" && !options.some((option) => option === value)
      ? [value, ...options]
      : options;

  return (
    <div className="subject-pick">
      <select
        aria-label={labels.field}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">{labels.notSet}</option>
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="subject-pick-add"
        title={labels.add}
        aria-label={labels.add}
        onClick={() => {
          setOpen(true);
        }}
      >
        +
      </button>
      {open && (
        <AddSubject
          labels={labels}
          onClose={() => {
            setOpen(false);
          }}
          onAdd={async (text) => {
            const stored = await onAdd(text);
            onChange(stored);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddSubject({
  labels,
  onClose,
  onAdd,
}: {
  labels: {
    addTitle: string;
    addHint: string;
    subject: string;
    save: string;
    cancel: string;
    saving: string;
    failed: string;
  };
  onClose: () => void;
  onAdd: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    box.current?.querySelector("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const submit = () => {
    if (busy || text.trim().length < 2) return;
    setBusy(true);
    setFailed(false);
    void onAdd(text.trim())
      .catch((error: unknown) => {
        // Say why, in the console at least. "Try again" with no reason is the
        // kind of failure somebody reports and nobody can act on -- this one
        // was a missing idempotency key, and the screen could not have said so.
        console.error("adding a document subject failed", error);
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div
      className="code-picker-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="code-picker subject-add"
        role="dialog"
        aria-modal="true"
        aria-label={labels.addTitle}
        ref={box}
      >
        <div className="code-picker-head">
          <strong>{labels.addTitle}</strong>
          <button
            type="button"
            className="code-picker-close"
            onClick={onClose}
            aria-label={labels.cancel}
          >
            ×
          </button>
        </div>
        <p className="settings-hint">{labels.addHint}</p>
        <input
          className="code-picker-search"
          value={text}
          maxLength={300}
          aria-label={labels.subject}
          placeholder={labels.subject}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        {failed && <p className="cargo-upload-failed">{labels.failed}</p>}
        <div className="subject-add-actions">
          <button
            type="button"
            className="primary"
            disabled={busy || text.trim().length < 2}
            onClick={submit}
          >
            {busy ? labels.saving : labels.save}
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            {labels.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
