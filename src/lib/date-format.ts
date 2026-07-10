function isValidDateParts(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;

  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= lastDay;
}

export function formatDateBR(value: string | null | undefined): string {
  if (!value) return "—";

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "—";

  const [, year, month, day] = match;
  if (!isValidDateParts(year, month, day)) return "—";

  return `${day}/${month}/${year}`;
}

export function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return "—";

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (!match) return "—";

  const [, year, month, day, hour, minute] = match;
  if (!isValidDateParts(year, month, day)) return "—";
  if (
    (hour && (Number(hour) > 23 || Number(hour) < 0)) ||
    (minute && (Number(minute) > 59 || Number(minute) < 0))
  ) {
    return "—";
  }

  const date = `${day}/${month}/${year}`;
  return hour && minute ? `${date} ${hour}:${minute}` : date;
}
