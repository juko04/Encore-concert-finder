'use client';

import React, { useState, useTransition } from 'react';
import {
  signInAction,
  signInWithMagicLinkAction,
  requestPasswordResetAction,
} from '@/app/login/actions';

interface LoginFormProps {
  redirectTo?: string;
  initialError?: string;
  defaultMethod?: 'magic_link' | 'password';
}

export function LoginForm({
  redirectTo = '/profile/taste',
  initialError,
  defaultMethod = 'magic_link',
}: LoginFormProps) {
  const [mode, setMode] = useState<'signin' | 'forgot_password'>('signin');
  const [authMethod, setAuthMethod] = useState<'magic_link' | 'password'>(
    defaultMethod,
  );
  const [error, setError] = useState<string | null>(initialError || null);
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
        if (mode === 'forgot_password') {
          const result = await requestPasswordResetAction(formData);
          if (result?.error) {
            setError(result.error);
          } else if (result?.message) {
            setSuccessMessage(result.message);
          }
          return;
        }

        // Mode is 'signin'
        const result =
          authMethod === 'magic_link'
            ? await signInWithMagicLinkAction(formData)
            : await signInAction(formData);

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
      className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
    >
      {/* Invite-Only Beta Badge */}
      <div className="mb-4 flex items-center justify-between">
        <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-indigo-600">
          Invite-Only Beta
        </span>
        {mode === 'forgot_password' && (
          <button
            type="button"
            data-testid="back-to-signin-btn"
            onClick={() => {
              setMode('signin');
              setError(null);
              setSuccessMessage(null);
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            ← Back to Sign In
          </button>
        )}
      </div>

      <h2 className="text-xl font-bold tracking-tight text-zinc-900">
        {mode === 'signin' ? 'Welcome Back' : 'Reset Your Password'}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        {mode === 'signin'
          ? authMethod === 'magic_link'
            ? 'Enter your invited email address to receive a secure, passwordless login link.'
            : 'Sign in with your password to access your saved music taste and recommendations.'
          : 'Enter your email address and we will send you a secure link to reset your password.'}
      </p>

      {/* Sign-in Method Switcher (Magic Link vs Password) */}
      {mode === 'signin' && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-1 text-xs font-medium">
          <button
            type="button"
            data-testid="method-magic-link"
            onClick={() => {
              setAuthMethod('magic_link');
              setError(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              authMethod === 'magic_link'
                ? 'shadow-xs bg-zinc-100 font-semibold text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Passwordless Link
          </button>
          <button
            type="button"
            data-testid="method-password"
            onClick={() => {
              setAuthMethod('password');
              setError(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 rounded-md py-1.5 text-center transition-colors ${
              authMethod === 'password'
                ? 'shadow-xs bg-zinc-100 font-semibold text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Password
          </button>
        </div>
      )}

      {error && (
        <div
          data-testid="auth-error-alert"
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          data-testid="auth-success-alert"
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium uppercase tracking-wider text-zinc-500"
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
            className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="you@example.com"
          />
        </div>

        {/* Password input shown only in password signin */}
        {mode === 'signin' && authMethod === 'password' && (
          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              data-testid="password-input"
              className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>
        )}

        {mode === 'signin' && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              data-testid="forgot-password-link"
              onClick={() => {
                setMode('forgot_password');
                setError(null);
                setSuccessMessage(null);
              }}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          data-testid="auth-submit-btn"
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Processing...
            </span>
          ) : mode === 'signin' ? (
            authMethod === 'magic_link' ? (
              'Sign In with Magic Link'
            ) : (
              'Sign In'
            )
          ) : (
            'Send Reset Link'
          )}
        </button>
      </form>
    </div>
  );
}
