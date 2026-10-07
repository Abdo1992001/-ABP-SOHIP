/**
 * The corner where slow work reports on itself.
 *
 * Producing a client report photographs every container in a plan, which takes
 * a second or two per container. Work that long has three bad endings and one
 * good one: it can block the screen, it can finish silently, it can leave the
 * person wondering whether it started — or it can sit in the corner counting up
 * and then hand over the result. This is the fourth.
 *
 * It is bottom-left rather than bottom-right on purpose: the right-hand corner
 * is where the shell already puts toasts, and two things fighting for one
 * corner is how a progress panel ends up underneath a notification.
 */

export type JobState = "RUNNING" | "DONE" | "FAILED";

export function BackgroundJob({
  title,
  detail,
  done,
  total,
  state,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  title: string;
  detail: string;
  done: number;
  total: number;
  state: JobState;
  /** Offered only once the work has finished. */
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <aside
      className={`background-job is-${state.toLowerCase()}`}
      role="status"
      aria-live="polite"
    >
      <div className="background-job-head">
        <strong>{title}</strong>
        <button
          type="button"
          className="background-job-close"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          ×
        </button>
      </div>
      <p>{detail}</p>
      {/* A real bar, driven by the count, not a spinner that spins whether or
          not anything is happening. */}
      <div
        className="background-job-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span style={{ width: `${String(Math.round(share * 100))}%` }} />
      </div>
      <div className="background-job-foot">
        <span className="background-job-count">
          {done} / {total}
        </span>
        {state === "DONE" && actionLabel !== undefined && (
          <button type="button" className="secondary" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </aside>
  );
}
