import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Server Boundary Enforcement', () => {
  const serverFiles = [
    'lib/supabase/admin.ts',
    'lib/repositories/catalog-repository.ts',
    'lib/repositories/source-repository.ts',
    'lib/repositories/raw-ingest-repository.ts',
    'lib/repositories/event-candidate-repository.ts',
  ];

  it.each(serverFiles)(
    'enforces that %s contains import "server-only" as its primary directive',
    (filePath) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*'),
        );

      expect(lines[0]).toBe("import 'server-only';");
    },
  );
});
