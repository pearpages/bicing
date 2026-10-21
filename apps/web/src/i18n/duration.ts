/** A gap's length: minutes under an hour, hours and minutes under two days, days beyond. */
export function duration(minutes: number, units: { day: string; days: string }): string {
  if (minutes < 60) return `${String(Math.round(minutes))} min`;
  if (minutes < 2_880) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }
  const days = Math.round(minutes / 1_440);
  return `${String(days)} ${days === 1 ? units.day : units.days}`;
}
