const parseDay = (value: string) => new Date(`${value}T12:00:00Z`);

const isWorkingDay = (date: Date) => {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

export function operationalDaysBetween(from: string, to: string) {
  if (!from || !to || from >= to) return 0;
  const cursor = parseDay(from);
  const end = parseDay(to);
  let days = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor)) days++;
  }
  return days;
}

export function shiftOperationalDay(value: string, offset: number) {
  const cursor = parseDay(value);
  const direction = offset < 0 ? -1 : 1;
  let remaining = Math.abs(offset);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (isWorkingDay(cursor)) remaining--;
  }
  return cursor.toISOString().slice(0, 10);
}
