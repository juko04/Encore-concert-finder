import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the URL -> filter-control sync: /search remounts SearchClient with a
// key derived from the resolved URL params. Removing it brings back stale
// filter controls when navigating between filtered /search URLs.
describe('REGRESSION search page remounts SearchClient per URL', () => {
  it('keeps key={JSON.stringify(resolvedParams)} on SearchClient', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../app/search/page.tsx'),
      'utf8',
    );
    expect(src).toMatch(
      /<SearchClient[\s\S]*?key=\{JSON\.stringify\(resolvedParams\)\}/,
    );
  });
});
