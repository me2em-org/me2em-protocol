// packages/pact/src/store/Export.ts — byte-exact sneakernet (D47, Р8).
//
// Format: newline-delimited canonical JCS of each event WITH its full
// sig[] (B-8: evHash equality does not prove byte equality of replicas
// — the export preserves signature sets). Separator is LF only; the
// export always terminates the last line with \n; the import accepts a
// missing final \n. Blank lines, whitespace around lines, invalid
// UTF-8/JSON and D35 limit violations reject — "skip and continue" is
// forbidden.

import { decodeEvent, encodeEvent } from '../codec.js';
import { PactError } from '../errors.js';
import type { Event } from '../types.js';

/** Exports the journal: JCS(event) per line, LF-terminated. */
export function exportJournal(events: Event[]): Uint8Array {
  const lines = events.map((e) => encodeEvent(e));
  const total = lines.reduce((acc, l) => acc + l.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const line of lines) {
    out.set(line, o);
    o += line.length;
    out[o++] = 0x0a; // LF
  }
  return out;
}

/** Imports a journal export: strict per-line parse, nothing skipped. */
export function importJournal(bytes: Uint8Array): Event[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PactError('MALFORMED', 'import', 'journal bytes are not valid UTF-8');
  }
  if (text === '') return [];
  if (text.includes('\r')) {
    throw new PactError('MALFORMED', 'import', 'CRLF is not permitted — LF only (Р8)');
  }
  const rawLines = text.split('\n');
  // The final empty element comes from the trailing LF — the only one allowed.
  const last = rawLines[rawLines.length - 1];
  if (last === '') rawLines.pop();
  else if (last.trim() === '') {
    throw new PactError('MALFORMED', 'import', 'blank line at end of journal');
  }
  if (rawLines.length === 0) return [];
  return rawLines.map((line, i) => {
    if (line === '' || /^\s/.test(line) || /\s$/.test(line)) {
      throw new PactError('MALFORMED', 'import', `line ${i}: blank or whitespace-padded`);
    }
    return decodeEvent(new TextEncoder().encode(line));
  });
}
