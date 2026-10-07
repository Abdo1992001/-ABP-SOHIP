# CD-WS2E-001 — Activity cancellation

Status: **APPROVED EXECUTION CORRECTION**

1. Cancellation is a lifecycle command, never an ordinary PATCH update.
2. `POST /activities/{activityId}/cancel` requires `activities.cancel`, a
   nonblank reason, `If-Match`, and an idempotency key.
3. Access uses the linked protected context and Country Scope before owner or
   manager context. Explicit DENY wins.
4. The command writes an immutable activity-history/audit event and cancels
   eligible active reminders in the same transaction. It never deletes the
   Activity or reminders.
5. COMPLETED/CANCELLED activities cannot be cancelled again. A stale ETag is a
   typed 412 conflict.

RG-02 remains OPEN. Baseline authorization and Release Gate state are
unchanged.
