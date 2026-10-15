import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'child_process';

const PORT = process.env.PORT || 3000;
const baseURL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

function resolveLocalSupabaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        NEXT_PUBLIC_SUPABASE_URL: url || parsed.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey || parsed.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Supabase CLI is not available or stack is not running
  }

  if (url) env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (anonKey) env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = anonKey;
  if (serviceRoleKey) env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  return env;
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      PORT: `${PORT}`,
      ...resolveLocalSupabaseEnv(),
    },
  },
});
