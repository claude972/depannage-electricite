// This candidate schedules interventions in Martinique/Guadeloupe (UTC−04:00).
export function appointmentTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const local = date + 'T' + time;
  const instant = new Date(local + ':00-04:00');
  if (!Number.isFinite(instant.valueOf())) return null;
  const reconstructed = new Date(instant.valueOf() - 4 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return reconstructed === local ? instant.toISOString() : null;
}

export function appointmentFields(value: string) {
  const local = new Date(Date.parse(value) - 4 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
