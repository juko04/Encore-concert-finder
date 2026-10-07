import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Server Boundary Regression Checks', () => {
  const serverOnlyFiles = [
    'lib/supabase/admin.ts',
    'lib/repositories/catalog-repository.ts',
    'lib/repositories/source-repository.ts',
    'lib/repositories/raw-ingest-repository.ts',
    'lib/repositories/event-candidate-repository.ts',
  ];

  it.each(serverOnlyFiles)(
    'ensures %s enforces server-only boundary as first import',
    (filePath) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf-8');
      const firstLine = content.split('\n')[0].trim();
      expect(firstLine).toBe("import 'server-only';");
    },
  );
});
