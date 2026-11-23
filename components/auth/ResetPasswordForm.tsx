'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { updatePasswordAction } from '@/app/login/actions';

interface ResetPasswordFormProps {
  hasSession?: boolean;
}

export function ResetPasswordForm({
  hasSession = true,
}: ResetPasswordFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const formData = new FormData(e.currentTarget);
    const password = formData.get('password')?.toString();
    const confirmPassword = formData.get('confirmPassword')?.toString();

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await updatePasswordAction(formData);
        if (result?.error) {
          setError(result.error);
        } else if (result?.message) {
          setSuccessMessage(result.message);
        }
      } catch {
        setError('An unexpected error occurred. Please try again.');
      }
    });
  }

  return (
    <div
      data-testid="reset-password-container"
      className="w-full max-w-md rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur"
    >
      <h2 className="text-xl font-bold tracking-tight text-white">
        Change Your Password
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        Enter and confirm your new password below.
      </p>

      {error && (
        <div
          data-testid="reset-password-error-alert"
          role="alert"
          className="mt-4 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {successMessage ? (
        <div className="mt-6 space-y-4">
          <div
            data-testid="reset-password-success-alert"
            role="status"
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 p-3 text-sm text-emerald-200"
          >
            {successMessage}
          </div>
          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Back to Sign In
          </Link>
        </div>
      ) : !hasSession ? (
        <div className="mt-6 space-y-4">
          <div
            data-testid="reset-password-no-session-alert"
            className="rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-sm text-amber-200"
          >
            No active password reset session was found. Please request a new
            password reset link from the login page.
          </div>
          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            Go to Login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              New Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              data-testid="new-password-input"
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="••••••••"
            />
            <p className="mt-1 text-xs text-zinc-500">Minimum 6 characters</p>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              data-testid="confirm-password-input"
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            data-testid="reset-password-submit-btn"
            className="mt-6 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Updating Password...
              </span>
            ) : (
              'Update Password'
            )}
          </button>
        </form>
      )}
    </div>
  );
}
