import React from 'react';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/LoginForm';

interface LoginPageProps {
  searchParams?: Promise<{
    redirectTo?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const redirectTo = resolvedParams.redirectTo || '/profile/taste';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mb-8 text-center">
        <Link
          href="/"
          className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          ← Back to Home
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <span className="text-white">Encore</span>{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            Authentication
          </span>
        </h1>
      </div>

      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
