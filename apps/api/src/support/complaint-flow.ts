/**
 * The route a complaint takes, as data: who may move it where, and what must
 * be on record before it moves. Pure, so the rules are tested without Nest.
 *
 *   OPEN (Sales logs it)
 *     -> OPERATIONS_REVIEW   Operations checks the order, the load, the delivery
 *     -> QUALITY_REVIEW      Quality (R&D) names the root cause
 *     -> SOLUTION            a named owner carries out the corrective action by a date
 *     -> RESOLVED            the customer has been given the solution
 *     -> CLOSED              Sales confirms the customer accepts it
 *
 * Operations may go straight to SOLUTION when the cause is plainly not a
 * product one (a short load, a late truck) -- it then names the cause itself.
 * Every step back needs a reason, because a step back is somebody saying the
 * previous stage's work was not enough.
 */

export const COMPLAINT_STAGES = [
  "OPEN",
  "OPERATIONS_REVIEW",
  "QUALITY_REVIEW",
  "SOLUTION",
  "RESOLVED",
  "CLOSED",
] as const;
export type ComplaintStage = (typeof COMPLAINT_STAGES)[number];

export const ROOT_CAUSES = [
  "MATERIAL",
  "PRODUCTION",
  "PACKAGING",
  "LOADING",
  "TRANSPORT",
  "SITE_HANDLING",
  "SPECIFICATION",
  "DOCUMENTATION",
  "BILLING",
  "SERVICE",
  "NOT_JUSTIFIED",
  "OTHER",
] as const;

export type RequiredField =
  | "reason"
  | "operationsFindings"
  | "rootCauseCode"
  | "rootCauseDetail"
  | "correctiveAction"
  | "solutionOwnerUserId"
  | "solutionDueDate"
  | "resolution";

export interface ComplaintMove {
  to: ComplaintStage;
  /** Any one of these lets the actor make the move. */
  permissions: readonly string[];
  /** The solution owner may also make this move, whatever their permissions. */
  solutionOwnerMay?: boolean;
  back?: boolean;
  requires: readonly RequiredField[];
}

const EDIT = "complaints.edit";
const CLOSE = "complaints.close";
const OPS = "complaints.operations-review";
const QUALITY = "complaints.quality-review";
const SOLUTION_FIELDS = [
  "rootCauseCode",
  "correctiveAction",
  "solutionOwnerUserId",
  "solutionDueDate",
] as const;

export const COMPLAINT_MOVES: Record<ComplaintStage, readonly ComplaintMove[]> =
  {
    OPEN: [{ to: "OPERATIONS_REVIEW", permissions: [EDIT, OPS], requires: [] }],
    OPERATIONS_REVIEW: [
      {
        to: "QUALITY_REVIEW",
        permissions: [OPS],
        requires: ["operationsFindings"],
      },
      {
        to: "SOLUTION",
        permissions: [OPS],
        requires: ["operationsFindings", ...SOLUTION_FIELDS],
      },
      { to: "OPEN", permissions: [OPS], back: true, requires: ["reason"] },
    ],
    QUALITY_REVIEW: [
      {
        to: "SOLUTION",
        permissions: [QUALITY],
        requires: ["rootCauseDetail", ...SOLUTION_FIELDS],
      },
      {
        to: "OPERATIONS_REVIEW",
        permissions: [QUALITY],
        back: true,
        requires: ["reason"],
      },
    ],
    SOLUTION: [
      {
        to: "RESOLVED",
        permissions: [EDIT, OPS],
        solutionOwnerMay: true,
        requires: ["resolution"],
      },
      {
        to: "QUALITY_REVIEW",
        permissions: [QUALITY, OPS],
        back: true,
        requires: ["reason"],
      },
    ],
    RESOLVED: [
      { to: "CLOSED", permissions: [CLOSE], requires: [] },
      {
        to: "SOLUTION",
        permissions: [EDIT, CLOSE],
        back: true,
        requires: ["reason"],
      },
    ],
    CLOSED: [],
  };

export function isComplaintStage(value: string): value is ComplaintStage {
  return (COMPLAINT_STAGES as readonly string[]).includes(value);
}

export function findMove(from: string, to: string): ComplaintMove | undefined {
  return isComplaintStage(from)
    ? COMPLAINT_MOVES[from].find((move) => move.to === to)
    : undefined;
}

export function mayMake(
  move: ComplaintMove,
  held: ReadonlySet<string>,
  isSolutionOwner: boolean,
): boolean {
  return (
    move.permissions.some((permission) => held.has(permission)) ||
    (move.solutionOwnerMay === true && isSolutionOwner)
  );
}

/** The moves this actor can make from `from`, in the order they are offered. */
export function movesFor(
  from: string,
  held: ReadonlySet<string>,
  isSolutionOwner: boolean,
): ComplaintMove[] {
  if (!isComplaintStage(from)) return [];
  return COMPLAINT_MOVES[from].filter((move) =>
    mayMake(move, held, isSolutionOwner),
  );
}

/** Which of the move's required fields are still empty, once body and record are merged. */
export function missingFields(
  move: ComplaintMove,
  values: Partial<Record<RequiredField, string | null | undefined>>,
): RequiredField[] {
  return move.requires.filter((field) => {
    const value = values[field];
    return (
      typeof value !== "string" ||
      value.trim().length < (field === "reason" ? 3 : 1)
    );
  });
}

/** Hours a stage may take before it is late; severity shortens them. */
const STAGE_HOURS: Partial<Record<ComplaintStage, number>> = {
  OPEN: 24,
  OPERATIONS_REVIEW: 48,
  QUALITY_REVIEW: 120,
  RESOLVED: 72,
};
const SEVERITY_FACTOR: Record<string, number> = { CRITICAL: 0.5, HIGH: 0.75 };

/**
 * When the stage just entered is due. The solution stage is due on the date
 * its owner committed to, at the end of that day; a closed complaint is due
 * nowhere.
 */
export function stageDueAt(input: {
  stage: ComplaintStage;
  enteredAt: Date;
  severityCode: string | null;
  solutionDueDate?: string | null;
}): Date | null {
  if (input.stage === "CLOSED") return null;
  if (input.stage === "SOLUTION") {
    return input.solutionDueDate
      ? new Date(`${input.solutionDueDate.slice(0, 10)}T23:59:59Z`)
      : null;
  }
  const hours = STAGE_HOURS[input.stage];
  if (hours === undefined) return null;
  const factor = SEVERITY_FACTOR[input.severityCode ?? ""] ?? 1;
  return new Date(input.enteredAt.getTime() + hours * factor * 3_600_000);
}

export function isLate(due: Date | null, stage: string, now: Date): boolean {
  return due !== null && stage !== "CLOSED" && due.getTime() < now.getTime();
}
