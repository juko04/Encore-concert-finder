import { describe, expect, it } from 'vitest';
import { isScoringPreviewAllowed } from '@/lib/recommendation/preview-guard';
import {
  getScoringPreviewAction,
  updateRecommendationPresetAction,
} from '@/app/discover/scoring-preview/actions';

describe('Scoring Preview Environment Guard & Security Policy', () => {
  it('allows scoring preview in development and test environments by default', () => {
    expect(isScoringPreviewAllowed({ nodeEnv: 'development' })).toBe(true);
    expect(isScoringPreviewAllowed({ nodeEnv: 'test' })).toBe(true);
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'development',
        previewFlag: 'false',
      }),
    ).toBe(false);
  });

  it('strictly forbids scoring preview in standard production deployments', () => {
    // Normal production deployment: no CI, no Playwright
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'production',
        isCi: false,
        isTest: false,
      }),
    ).toBe(false);

    // Accidental feature flag in normal production MUST NOT expose preview
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'production',
        previewFlag: 'true',
        isCi: false,
        isTest: false,
      }),
    ).toBe(false);
  });

  it('permits preview in production mode ONLY during automated test runs with explicit flag', () => {
    // Production build under CI with explicit opt-in
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'production',
        isCi: 'true',
        previewFlag: 'true',
      }),
    ).toBe(true);

    // Production build under Playwright test with explicit opt-in
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'production',
        isTest: 'true',
        previewFlag: 'true',
      }),
    ).toBe(true);

    // In automated test without explicit flag: remains disabled
    expect(
      isScoringPreviewAllowed({
        nodeEnv: 'production',
        isCi: 'true',
        previewFlag: undefined,
      }),
    ).toBe(false);
  });

  it('server actions reject invalid scoring presets without silent fallback or raw error leaks', async () => {
    const res = await getScoringPreviewAction({
      preset: 'malicious_preset_injection',
    });

    expect(res.error).toBeDefined();
    expect(res.error).toContain('Invalid recommendation preset');
    // Ensure no stack traces or database connection details leak
    expect(res.error).not.toContain('postgres://');
    expect(res.error).not.toContain('at ');
    expect(res.usingFixtures).toBe(false);
  });

  it('rejects prototype properties when validating requested preset', async () => {
    const res = await getScoringPreviewAction({
      preset: 'toString',
    });

    expect(res.error).toBeDefined();
    expect(res.error).toContain('Invalid recommendation preset');
  });

  it('updateRecommendationPresetAction rejects invalid preset inputs on the server', async () => {
    const res = await updateRecommendationPresetAction('invalid_preset');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid recommendation preset');
  });

  it('labels fixture data explicitly as synthetic demo fixtures', async () => {
    const res = await getScoringPreviewAction({
      useFixtures: true,
      preset: 'balanced',
    });

    expect(res.usingFixtures).toBe(true);
    expect(res.isSyntheticDemo).toBe(true);
    expect(res.dataSource).toBe('synthetic_fixtures');
    expect(res.result.recommendations.length).toBeGreaterThan(0);
  });
});
