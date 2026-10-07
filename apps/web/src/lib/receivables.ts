/**
 * When an installment is due, in words -- including the ones whose clock has
 * not started: "30 days after delivery" is a real answer before delivery, and
 * a blank would read as "no date agreed".
 */
export function dueText(
  row: { dueDate?: unknown; dueBasisCode?: unknown; daysAfter?: unknown },
  txt: (en: string, ar: string) => string,
  date: (value: string) => string,
): string {
  if (typeof row.dueDate === "string" && row.dueDate !== "")
    return date(row.dueDate);
  if (row.dueBasisCode === "AFTER_HANDOVER") {
    const days = Number(row.daysAfter) || 0;
    return txt(
      `${String(days)} days after delivery`,
      `بعد التسليم بـ ${String(days)} يوم`,
    );
  }
  return "—";
}
