/**
 * Environment Guard for Recommendation Scoring Inspector
 *
 * Security Invariant:
 * - Development and local test environments allow the scoring inspector by default.
 * - Ordinary production deployments STRICTLY FORBID access to the scoring inspector.
 *   Direct URL requests in production will receive a 404 (notFound()), and server
 *   actions independently reject preview requests.
 * - In production mode, preview is permitted ONLY in isolated automated test environments
 *   (CI runner or Playwright runner) when explicitly opted into via ENABLE_RECOMMENDATION_DEV_PREVIEW=true.
 */

export interface ScoringPreviewGuardOptions {
  nodeEnv?: string;
  previewFlag?: string;
  isCi?: string | boolean;
  isTest?: string | boolean;
}

export function isScoringPreviewAllowed(
  optionsOrNodeEnv?: string | ScoringPreviewGuardOptions,
  previewFlagParam?: string,
): boolean {
  let nodeEnv: string | undefined = process.env.NODE_ENV;
  let previewFlag = process.env.ENABLE_RECOMMENDATION_DEV_PREVIEW;
  let isCi: string | boolean | undefined = process.env.CI;
  let isTest: string | boolean | undefined = process.env.PLAYWRIGHT_TEST;

  if (typeof optionsOrNodeEnv === 'object' && optionsOrNodeEnv !== null) {
    if (optionsOrNodeEnv.nodeEnv !== undefined)
      nodeEnv = optionsOrNodeEnv.nodeEnv;
    if (optionsOrNodeEnv.previewFlag !== undefined)
      previewFlag = optionsOrNodeEnv.previewFlag;
    if (optionsOrNodeEnv.isCi !== undefined) isCi = optionsOrNodeEnv.isCi;
    if (optionsOrNodeEnv.isTest !== undefined) isTest = optionsOrNodeEnv.isTest;
  } else if (typeof optionsOrNodeEnv === 'string') {
    nodeEnv = optionsOrNodeEnv;
    if (previewFlagParam !== undefined) {
      previewFlag = previewFlagParam;
    }
  }

  // 1. Local development and standard test runners permit preview by default
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return previewFlag !== 'false';
  }

  // 2. Production: strictly disabled in ordinary production deployments.
  // Permitted ONLY if both:
  //   a) Running in an automated test environment (CI or Playwright runner)
  //   b) Explicitly enabled via ENABLE_RECOMMENDATION_DEV_PREVIEW=true
  const isAutomatedTest =
    isCi === true ||
    isCi === 'true' ||
    isCi === '1' ||
    isTest === true ||
    isTest === 'true' ||
    isTest === '1';

  if (isAutomatedTest && previewFlag === 'true') {
    return true;
  }

  return false;
}
