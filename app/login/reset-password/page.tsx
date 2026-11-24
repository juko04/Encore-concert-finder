import Link from 'next/link';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { Header } from '@/components/index/Header';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage() {
  const user = await getAuthenticatedUser();

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-8 text-center">
          <Link
            href="/login"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            ← Back to Sign In
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Reset Password
          </h1>
        </div>

        <ResetPasswordForm hasSession={Boolean(user)} />
      </main>
    </div>
  );
}
