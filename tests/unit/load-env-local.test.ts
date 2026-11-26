import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvLocal, parseEnvFile } from '@/lib/utils/load-env-local';

describe('parseEnvFile', () => {
  it('skips blanks, comments, lines without = and empty keys', () => {
    const out = parseEnvFile(
      ['', '  # comment', 'NOEQUALS', '=novalue', '  A = 1  ', 'B=2'].join(
        '\n',
      ),
    );
    expect(out).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
  });

  it('strips matching surrounding quotes only', () => {
    const out = Object.fromEntries(
      parseEnvFile(`D="dq val"\nS='sq val'\nM="mismatch'\nN=a"b"c\nE=`),
    );
    expect(out).toEqual({
      D: 'dq val',
      S: 'sq val',
      M: `"mismatch'`,
      N: 'a"b"c',
      E: '',
    });
  });

  it('splits on the first = so values may contain =', () => {
    expect(parseEnvFile('URL=https://x.test/?a=b')).toEqual([
      ['URL', 'https://x.test/?a=b'],
    ]);
  });
});

describe('loadEnvLocal', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encore-env-'));
    env = {} as NodeJS.ProcessEnv;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when the file is missing', () => {
    expect(() =>
      loadEnvLocal(path.join(dir, 'missing.env'), env),
    ).not.toThrow();
    expect(env).toEqual({});
  });

  it('fills unset variables and never overwrites non-empty existing ones', () => {
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(file, 'KEEP=file\nNEW=file\nEMPTY=file\n');
    env.KEEP = 'shell';
    env.EMPTY = '';
    loadEnvLocal(file, env);
    expect(env.KEEP).toBe('shell');
    expect(env.NEW).toBe('file');
    expect(env.EMPTY).toBe('file');
  });

  it('uses the first occurrence when a key repeats in the file', () => {
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(file, 'K=first\nK=second\n');
    loadEnvLocal(file, env);
    expect(env.K).toBe('first');
  });

  it('defaults to .env.local in the working directory and process.env', () => {
    const cwd = process.cwd();
    const key = `ENCORE_TEST_ENV_${Date.now()}`;
    fs.writeFileSync(path.join(dir, '.env.local'), `${key}="v1"\n`);
    try {
      process.chdir(dir);
      loadEnvLocal();
      expect(process.env[key]).toBe('v1');
    } finally {
      process.chdir(cwd);
      delete process.env[key];
    }
  });
});
