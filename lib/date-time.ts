const UK_TIME_ZONE = "Europe/London";

function londonParts(timestamp: number): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
}

export function ukDateTimeInput(timestamp: number): string {
  const parts = londonParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function ukDateTimeToIso(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desired = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let timestamp = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = londonParts(timestamp);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    timestamp += desired - represented;
  }
  const result = new Date(timestamp);
  if (Number.isNaN(result.getTime()) || ukDateTimeInput(timestamp) !== value) return null;
  return result.toISOString();
}

export function ukDateTimeFromParts(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  const wallTime = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const iso = ukDateTimeToIso(wallTime);
  return iso ? new Date(iso) : null;
}

export function londonNowParts(): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = londonParts(Date.now());
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: date.getUTCDay(),
  };
}
