'use client';

import React, { useState, useTransition } from 'react';
import { signInAction, signUpAction } from '@/app/login/actions';

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo = '/profile/taste' }: LoginFormProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const formData = new FormData(e.currentTarget);
    formData.set('redirectTo', redirectTo);

    startTransition(async () => {
      try {
        const action = mode === 'signin' ? signInAction : signUpAction;
        const result = await action(formData);

        if (result?.error) {
          setError(result.error);
        } else if (result?.message) {
          setSuccessMessage(result.message);
        }
      } catch (err) {
        // Next.js redirect() throws an internal NEXT_REDIRECT error which is expected
        if (
          err &&
          typeof err === 'object' &&
          'digest' in err &&
          typeof (err as { digest: string }).digest === 'string' &&
          (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
        ) {
          throw err;
        }
        setError('An unexpected error occurred. Please try again.');
      }
    });
  }

  return (
    <div
      data-testid="login-container"
      className="w-full max-w-md rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur"
    >
      <div className="mb-6 flex border-b border-zinc-800">
        <button
          type="button"
          data-testid="tab-signin"
          onClick={() => {
            setMode('signin');
            setError(null);
            setSuccessMessage(null);
          }}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mode === 'signin'
              ? 'border-b-2 border-indigo-500 text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          data-testid="tab-signup"
          onClick={() => {
            setMode('signup');
            setError(null);
            setSuccessMessage(null);
          }}
          className={`ml-6 pb-3 text-sm font-semibold transition-colors ${
            mode === 'signup'
              ? 'border-b-2 border-indigo-500 text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Create Account
        </button>
      </div>

      <h2 className="text-xl font-bold tracking-tight text-white">
        {mode === 'signin' ? 'Welcome Back' : 'Create an Account'}
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        {mode === 'signin'
          ? 'Sign in to access your saved music taste and personal recommendations.'
          : 'Create your Encore profile to curate your music taste and track concerts.'}
      </p>

      {error && (
        <div
          data-testid="auth-error-alert"
          role="alert"
          className="mt-4 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          data-testid="auth-success-alert"
          role="status"
          className="mt-4 rounded-lg border border-emerald-800/60 bg-emerald-950/40 p-3 text-sm text-emerald-200"
        >
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
          >
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            data-testid="email-input"
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === 'signin' ? 'current-password' : 'new-password'
            }
            required
            data-testid="password-input"
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          data-testid="auth-submit-btn"
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Processing...
            </span>
          ) : mode === 'signin' ? (
            'Sign In'
          ) : (
            'Create Account'
          )}
        </button>
      </form>
    </div>
  );
}
