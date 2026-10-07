/**
 * Today's date as the person at the screen would write it: YYYY-MM-DD in
 * their own time zone.
 *
 * `new Date().toISOString().slice(0, 10)` is today in London. Cairo is two or
 * three hours ahead, so from midnight until then it is still yesterday there --
 * a collection received this morning could not be dated today, because the
 * date picker's maximum was yesterday.
 */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
