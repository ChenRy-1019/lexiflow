/** Date helpers for the weekly chart. */

/** The Chinese weekday name for a `Date.getDay()` value. */
const WEEKDAYS = ["\u65e5", "\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d"];

/**
 * Labels for the seven-day window ending today.
 *
 * The backend returns the most recent seven calendar days in chronological
 * order, so the last entry is always today. The labels have to come from the
 * real dates: a fixed Monday-through-Sunday list would put a Friday under
 * "\u65e5".
 */
export function weekDayLabels(): Array<{ label: string; isToday: boolean }> {
  const today = new Date();
  const labels: Array<{ label: string; isToday: boolean }> = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    labels.push({ label: WEEKDAYS[day.getDay()], isToday: offset === 0 });
  }
  return labels;
}
