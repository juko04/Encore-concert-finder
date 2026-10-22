import { z } from 'zod';

export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ required_error: 'SUPABASE_SERVICE_ROLE_KEY is required' })
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  TICKETMASTER_API_KEY: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().url().optional(),
  SPOTIFY_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'SPOTIFY_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    )
    .optional(),
  ENABLE_SPOTIFY_INTEGRATION: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
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
    TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY,
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
    SPOTIFY_TOKEN_ENCRYPTION_KEY: process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    ENABLE_SPOTIFY_INTEGRATION: process.env.ENABLE_SPOTIFY_INTEGRATION,
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
