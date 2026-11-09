// Philadelphia time helpers, shared by the screens and the server.
export const TZ = 'America/New_York';

// Philadelphia calendar date parts for a Date
export function nyParts(d: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: p.weekday };
}

// The instant that is hour:minute Philadelphia time on the given date (handles daylight saving)
export function nyInstant(y: number, m: number, d: number, hour: number, minute = 0) {
  let t = Date.UTC(y, m - 1, d, hour + 5, minute);
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(t));
    const diff = (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Date.UTC(y, m - 1, d, hour, minute)) / 60000;
    t -= diff * 60000;
  }
  return new Date(t);
}

// "4:15 PM" for an instant, Philadelphia time
export const clock = (d: Date | string) =>
  new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

// "16:15" for an instant, Philadelphia time (what a time field holds)
export function hhmm(d: Date | string) {
  const p = nyParts(new Date(d));
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

// Meetup hours
export const OPEN = { h: 7, m: 30 };
export const CLOSE = { h: 20, m: 0 };
