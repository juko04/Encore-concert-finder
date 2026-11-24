// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signInWithMagicLinkAction, signUpAction } from '@/app/login/actions';
import { LoginForm } from '@/components/auth/LoginForm';

// Mock Supabase Server Client
const mockSignInWithOtp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockAuth = {
  signInWithOtp: mockSignInWithOtp,
  signInWithPassword: mockSignInWithPassword,
  exchangeCodeForSession: mockExchangeCodeForSession,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: mockAuth,
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error('NEXT_REDIRECT');
    (err as unknown as { digest: string }).digest =
      `NEXT_REDIRECT;replace;${url};307;`;
    throw err;
  }),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: vi.fn((header: string) => {
      if (header === 'host') return 'localhost:3000';
      if (header === 'x-forwarded-proto') return 'https';
      return null;
    }),
  })),
}));

vi.mock('@/lib/env/public', () => ({
  getPublicEnv: vi.fn(() => ({
    NEXT_PUBLIC_APP_URL: 'https://encore.live',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  })),
}));

describe('Invite-Only Passwordless Magic Link Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signInWithMagicLinkAction', () => {
    it('returns error when email is missing', async () => {
      const formData = new FormData();
      const result = await signInWithMagicLinkAction(formData);
      expect(result.error).toBe('Email address is required.');
    });

    it('returns error when email format is invalid', async () => {
      const formData = new FormData();
      formData.set('email', 'invalid-email');
      const result = await signInWithMagicLinkAction(formData);
      expect(result.error).toBe('Please enter a valid email address.');
    });

    it('invokes supabase.auth.signInWithOtp with shouldCreateUser: false and returns success', async () => {
      mockSignInWithOtp.mockResolvedValueOnce({ data: {}, error: null });

      const formData = new FormData();
      formData.set('email', 'invited-user@encore.live');
      formData.set('redirectTo', '/profile/taste');

      const result = await signInWithMagicLinkAction(formData);

      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'invited-user@encore.live',
        options: {
          shouldCreateUser: false,
          emailRedirectTo: expect.stringContaining(
            '/auth/callback?next=%2Fprofile%2Ftaste',
          ),
        },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Magic link sent!');
    });

    it('returns friendly invite-only message when Supabase reports signups not allowed or user not found', async () => {
      mockSignInWithOtp.mockResolvedValueOnce({
        data: null,
        error: { message: 'Signups not allowed for otp' },
      });

      const formData = new FormData();
      formData.set('email', 'uninvited-stranger@example.com');

      const result = await signInWithMagicLinkAction(formData);

      expect(result.error).toBe(
        'This email has not been invited yet. Encore is currently invite-only.',
      );
    });
  });

  describe('signUpAction (Disabled for Invite-Only)', () => {
    it('rejects public self-registration requests', async () => {
      const formData = new FormData();
      formData.set('email', 'stranger@example.com');
      formData.set('password', 'Secret123!');

      const result = await signUpAction(formData);

      expect(result.error).toBe(
        'Public self-registration is disabled. Encore is currently invite-only.',
      );
    });
  });

  describe('LoginForm Passwordless UI Mode', () => {
    it('defaults to magic link passwordless mode with no public create account tab', () => {
      render(<LoginForm redirectTo="/profile/taste" />);

      // Magic link is active by default
      expect(screen.queryByTestId('password-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Sign In with Magic Link',
      );
      // Public create account tab is completely removed
      expect(screen.queryByTestId('tab-signup')).not.toBeInTheDocument();
    });

    it('switches to passwordless magic link method and submits successfully', async () => {
      mockSignInWithOtp.mockResolvedValueOnce({ data: {}, error: null });

      render(
        <LoginForm redirectTo="/profile/taste" defaultMethod="password" />,
      );

      // Switch to Passwordless Link method
      fireEvent.click(screen.getByTestId('method-magic-link'));

      expect(
        screen.getByText(/Enter your invited email address/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('password-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Sign In with Magic Link',
      );

      // Fill in invited email and submit
      fireEvent.change(screen.getByTestId('email-input'), {
        target: { value: 'invited-vip@encore.live' },
      });
      fireEvent.click(screen.getByTestId('auth-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('auth-success-alert')).toBeInTheDocument();
        expect(screen.getByTestId('auth-success-alert')).toHaveTextContent(
          'Magic link sent!',
        );
      });
    });

    it('displays error when uninvited user attempts passwordless login', async () => {
      mockSignInWithOtp.mockResolvedValueOnce({
        data: null,
        error: { message: 'User not found' },
      });

      render(
        <LoginForm redirectTo="/profile/taste" defaultMethod="magic_link" />,
      );

      fireEvent.change(screen.getByTestId('email-input'), {
        target: { value: 'uninvited@example.com' },
      });
      fireEvent.click(screen.getByTestId('auth-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('auth-error-alert')).toBeInTheDocument();
        expect(screen.getByTestId('auth-error-alert')).toHaveTextContent(
          'This email has not been invited yet. Encore is currently invite-only.',
        );
      });
    });
  });

  describe('Auth Callback Route Handler (app/auth/callback/route.ts)', () => {
    it('exchanges code for session and redirects to validated origin', async () => {
      const { GET } = await import('@/app/auth/callback/route');
      const mockExchangeCode = vi.fn().mockResolvedValue({ error: null });
      mockAuth.exchangeCodeForSession = mockExchangeCode;

      const req = new Request(
        'http://localhost:3000/auth/callback?code=valid-auth-code&next=/profile/taste',
      );
      const res = await GET(req);

      expect(mockExchangeCode).toHaveBeenCalledWith('valid-auth-code');
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/profile/taste');
    });

    it('redirects to login with error parameter when code exchange fails', async () => {
      const { GET } = await import('@/app/auth/callback/route');
      const mockExchangeCode = vi.fn().mockResolvedValue({
        error: { message: 'Auth code expired' },
      });
      mockAuth.exchangeCodeForSession = mockExchangeCode;

      const req = new Request(
        'http://localhost:3000/auth/callback?code=expired-code',
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login?error=');
    });
  });
});
