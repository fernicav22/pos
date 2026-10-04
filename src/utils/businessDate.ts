// Fixed business timezone - staff may access from devices set to any system timezone,
// so day boundaries for closing-related screens must not depend on the browser's locale.
export const BUSINESS_TZ = 'America/Ciudad_Juarez';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Formats any instant (Date or ISO string) as its YYYY-MM-DD business-local calendar date.
export function toBusinessDateString(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return dateFormatter.format(date);
}

export function getBusinessToday(): string {
  return toBusinessDateString(new Date());
}
