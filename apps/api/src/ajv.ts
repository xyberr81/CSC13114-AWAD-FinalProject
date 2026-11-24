// Ajv keywords that body schemas use. They sit beside the standard ones so a validation problem
// lists every broken field, each with a sentence a client can show (contract §1, §4.1).

interface ErrorEntry {
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, never>;
}
interface DataContext {
  instancePath: string;
}
type Check<T> = {
  (schema: unknown, data: T, parentSchema?: unknown, dataCxt?: DataContext): boolean;
  errors?: ErrorEntry[];
};

/** Records the errors on the check, as Ajv expects, and says whether there were none. */
function report<T>(
  check: Check<T>,
  keyword: string,
  errors: [path: string, message: string][],
  base = '',
): boolean {
  check.errors = errors.map(([path, message]) => ({
    instancePath: base + path,
    keyword,
    message,
    params: {},
  }));
  return errors.length === 0;
}

/** `'any'`: no U+0000. `'nonblank'`: also a character that is not whitespace. */
const text: Check<string> = (mode, data) => {
  const errors: [string, string][] = [];
  if (data.includes('\u0000')) errors.push(['', 'must not contain the character U+0000']);
  if (mode === 'nonblank' && !/\S/.test(data)) {
    errors.push(['', 'must contain a character that is not whitespace']);
  }
  return report(text, 'x-text', errors);
};

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const MIN_INSTANT = Date.UTC(1, 0, 1);
const MAX_INSTANT = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/** The instant an RFC 3339 date-time with an offset names, or null if no Date can hold it. */
export function parseInstant(value: string): Date | null {
  const m = RFC3339.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const calendar = new Date(Date.UTC(2000, month - 1, day));
  calendar.setUTCFullYear(year);
  // A day that rolled into the next month (30 February) is not a day. Second 60 is a leap
  // second: RFC 3339 allows it, a Date cannot hold it.
  const real = month >= 1 && month <= 12 && calendar.getUTCMonth() === month - 1;
  if (!real || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59)
    return null;
  const at = Date.parse(value);
  return at >= MIN_INSTANT && at <= MAX_INSTANT ? new Date(at) : null;
}

const instant: Check<string> = (_schema, data) =>
  report(
    instant,
    'x-instant',
    parseInstant(data)
      ? []
      : [['', 'must be an RFC 3339 date-time with an offset, such as 2026-12-01T15:00:00Z']],
  );

/** An array of objects whose `code` differs; each repeat gets an error at its own `code`. */
const uniqueCode: Check<{ code?: unknown }[]> = (_schema, data, _parent, cxt) => {
  const seen = new Set<unknown>();
  const errors: [string, string][] = [];
  data.forEach((item, i) => {
    if (seen.has(item.code)) {
      errors.push([`/${i}/code`, 'must differ from the code of an earlier item']);
    }
    seen.add(item.code);
  });
  return report(uniqueCode, 'x-unique-code', errors, cxt?.instancePath);
};

export const keywords = [
  {
    keyword: 'x-text',
    type: 'string' as const,
    schemaType: 'string' as const,
    errors: true,
    validate: text,
  },
  {
    keyword: 'x-instant',
    type: 'string' as const,
    schemaType: 'boolean' as const,
    errors: true,
    validate: instant,
  },
  {
    keyword: 'x-unique-code',
    type: 'array' as const,
    schemaType: 'boolean' as const,
    errors: true,
    validate: uniqueCode,
  },
];
