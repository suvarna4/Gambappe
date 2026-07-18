/**
 * ET (America/New_York) conversion helpers (INV-9: everything stored as
 * UTC; ET is a scheduling-layer concept only).
 */

const ET_ZONE = "America/New_York";

/** Convert a wall-clock "HH:MM" on a given "YYYY-MM-DD" date in ET to a UTC Date. */
export function etDateTimeToUtc(dateStr: string, hhmm: string): Date {
  const asUtc = new Date(`${dateStr}T${hhmm}:00Z`);
  const tzString = asUtc.toLocaleString("en-US", { timeZone: ET_ZONE });
  const utcString = asUtc.toLocaleString("en-US", { timeZone: "UTC" });
  const offsetMs = new Date(utcString).getTime() - new Date(tzString).getTime();
  return new Date(asUtc.getTime() + offsetMs);
}

/** Today's date (YYYY-MM-DD) as observed in ET at the given instant. */
export function etDateStr(at: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at); // en-CA gives YYYY-MM-DD
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
