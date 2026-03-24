/**
 * parser.ts — Zero-dependency CLI argument parser for AgentSentry.
 *
 * Parses argv into a structured result: command name, positional args,
 * and flags (--key value, --flag, --no-flag).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  /** The subcommand name (first positional), or undefined if none. */
  command?: string;
  /** Remaining positional arguments after the command. */
  positionals: string[];
  /** Parsed flags: --key value → { key: "value" }, --flag → { flag: true }, --no-flag → { flag: false }. */
  flags: Record<string, string | boolean>;
}

export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  run: (args: ParsedArgs) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse process.argv-style array (skip first two entries: node + script).
 */
export function parse(argv: string[]): ParsedArgs {
  const raw = argv.slice(2);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < raw.length) {
    const arg = raw[i];

    if (arg === '--') {
      // Everything after -- is positional
      positionals.push(...raw.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else if (arg.startsWith('--no-')) {
        // --no-flag → flag: false
        flags[arg.slice(5)] = false;
      } else {
        const key = arg.slice(2);
        const next = raw[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag: -j, -h, etc.
      const key = arg.slice(1);
      const next = raw[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }

    i++;
  }

  const command = positionals.shift();
  return { command, positionals, flags };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Print a value as JSON or formatted text. */
export function output(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n');
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

/** Print a table from an array of objects. */
export function table(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    process.stdout.write('(no data)\n');
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) => {
    const maxVal = Math.max(...rows.map((r) => String(r[c] ?? '').length));
    return Math.max(c.length, maxVal);
  });

  // Header
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  process.stdout.write(header + '\n' + separator + '\n');

  // Rows
  for (const row of rows) {
    const line = cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  ');
    process.stdout.write(line + '\n');
  }
}

/** Return true if --json or -j flag is set. */
export function isJson(flags: Record<string, string | boolean>): boolean {
  return flags['json'] === true || flags['j'] === true;
}
