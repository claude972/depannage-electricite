const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Martinique", year: "numeric", month: "2-digit", day: "2-digit",
});

export function martiniqueDate(instant: number = Date.now()): string {
  return localDate.format(instant);
}
