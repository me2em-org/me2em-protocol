// canonical-name.ts

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._@-]{0,62}$/;

export function normalizeName(raw: string): string {
  if (typeof raw !== 'string') throw new TypeError('Name must be a string');
  const name = raw.normalize('NFKC').toLowerCase().trim();
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid name: ${JSON.stringify(raw)}`);
  }
  return name;
}
