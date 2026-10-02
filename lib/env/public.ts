import { z } from 'zod';

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string({ required_error: 'NEXT_PUBLIC_SUPABASE_URL is required' })
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({
      required_error: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required',
    })
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) {
    return cachedPublicEnv;
  }

  const rawEnv = {
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const parsed = publicEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(
      `Invalid public environment configuration: ${errorMessages}`,
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

export function resetPublicEnvCache(): void {
  cachedPublicEnv = null;
}
