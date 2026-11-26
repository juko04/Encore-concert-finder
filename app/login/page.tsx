import { LoginForm } from '@/components/auth/LoginForm';
import { Header } from '@/components/index/Header';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams?: Promise<{
    redirectTo?: string;
    error?: string;
    method?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const redirectTo = sanitizeRedirectPath(resolvedParams.redirectTo);
  const error = resolvedParams.error;
  const method =
    resolvedParams.method === 'password' ? 'password' : 'magic_link';

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={false} />
      <main className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Sign in to Encore
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Personalized recommendations, saved shows, and Spotify taste import.
          </p>
        </div>

        <LoginForm
          redirectTo={redirectTo}
          initialError={error}
          defaultMethod={method}
        />
      </main>
    </div>
  );
}
