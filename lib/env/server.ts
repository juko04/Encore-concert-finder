import { z } from 'zod';

export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ required_error: 'SUPABASE_SERVICE_ROLE_KEY is required' })
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Server environment variables cannot be accessed in the browser',
    );
  }

  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  const rawEnv = {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const parsed = serverEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(
      `Invalid server environment configuration: ${errorMessages}`,
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function resetServerEnvCache(): void {
  cachedServerEnv = null;
}
