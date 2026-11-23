'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { getPublicEnv } from '@/lib/env/public';

export interface AuthActionResult {
  error?: string;
  success?: boolean;
  message?: string;
}

/**
 * Returns a validated application origin strictly derived from configured environment variables.
 * Never uses untrusted incoming HTTP request headers (Host or x-forwarded-proto).
 */
function getValidatedAppOrigin(): string {
  let rawUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  try {
    rawUrl = getPublicEnv().NEXT_PUBLIC_APP_URL?.trim() || rawUrl;
  } catch {
    // Fall back to process.env if public env validation is not loaded
  }

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Invalid URL format; fall back to safe default
    }
  }

  return 'http://localhost:3000';
}

export async function signInAction(
  formData: FormData,
): Promise<AuthActionResult> {
  const email = formData.get('email')?.toString().trim();
  const password = formData.get('password')?.toString();
  const redirectTo = sanitizeRedirectPath(
    formData.get('redirectTo')?.toString(),
  );

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect(redirectTo);
}

export async function signInWithMagicLinkAction(
  formData: FormData,
): Promise<AuthActionResult> {
  const email = formData.get('email')?.toString().trim();
  const redirectTo = sanitizeRedirectPath(
    formData.get('redirectTo')?.toString() || '/profile/taste',
  );

  if (!email) {
    return { error: 'Email address is required.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }

  try {
    const supabase = await createClient();

    const origin = getValidatedAppOrigin();
    const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('signups not allowed') ||
        msg.includes('user not found') ||
        msg.includes('signup disabled') ||
        msg.includes('not authorized')
      ) {
        return {
          error:
            'This email has not been invited yet. Encore is currently invite-only.',
        };
      }
      return { error: error.message };
    }

    return {
      success: true,
      message:
        'Magic link sent! Check your inbox for your secure, passwordless login link.',
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred. Please try again.';
    return { error: message };
  }
}

export async function signUpAction(
  _formData: FormData,
): Promise<AuthActionResult> {
  void _formData;
  return {
    error:
      'Public self-registration is disabled. Encore is currently invite-only.',
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function requestPasswordResetAction(
  formData: FormData,
): Promise<AuthActionResult> {
  const email = formData.get('email')?.toString().trim();

  if (!email) {
    return { error: 'Email address is required.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }

  try {
    const supabase = await createClient();

    const origin = getValidatedAppOrigin();
    const redirectTo = `${origin}/auth/callback?next=/login/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      return { error: error.message };
    }

    return {
      success: true,
      message:
        'If an account exists for this email, we have sent a password reset link. Please check your inbox.',
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred while requesting a password reset. Please try again.';
    return {
      error: message,
    };
  }
}

export async function updatePasswordAction(
  formData: FormData,
): Promise<AuthActionResult> {
  const password = formData.get('password')?.toString();
  const confirmPassword = formData.get('confirmPassword')?.toString();

  if (!password) {
    return { error: 'New password is required.' };
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters long.' };
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/', 'layout');
    return {
      success: true,
      message:
        'Your password has been successfully updated! You can now sign in with your new password.',
    };
  } catch {
    return {
      error:
        'An unexpected error occurred while updating your password. Please try again.',
    };
  }
}
