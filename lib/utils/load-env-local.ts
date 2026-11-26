import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse the contents of a dotenv-style file into key/value pairs.
 *
 * Rules (intentionally minimal, matching the historical per-script loaders):
 * - Lines are trimmed; blank lines and lines starting with `#` are skipped.
 * - The first `=` splits key from value; lines with no `=` or an empty key are skipped.
 * - A value wrapped in matching single or double quotes has them removed.
 * - No variable expansion, no inline-comment stripping, no `export` prefix handling.
 */
export function parseEnvFile(contents: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    entries.push([key, val]);
  }
  return entries;
}

/**
 * Load `.env.local` (relative to the current working directory by default)
 * into `process.env` for CLI scripts.
 *
 * Precedence: a variable that is already set to a non-empty value in the
 * environment is never overwritten; unset or empty-string variables are filled
 * from the file. A missing file is a silent no-op.
 */
export function loadEnvLocal(
  envPath: string = path.resolve(process.cwd(), '.env.local'),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!fs.existsSync(envPath)) return;
  for (const [key, val] of parseEnvFile(fs.readFileSync(envPath, 'utf-8'))) {
    if (!env[key]) env[key] = val;
  }
}
