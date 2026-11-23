// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockExchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: {
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockImplementation((name: string) => {
      if (name === 'host') return 'localhost:3000';
      if (name === 'x-forwarded-proto') return 'http';
      return null;
    }),
  }),
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import {
  requestPasswordResetAction,
  updatePasswordAction,
} from '@/app/login/actions';
import { LoginForm } from '@/components/auth/LoginForm';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { GET as authCallbackGet } from '@/app/auth/callback/route';

describe('Password Reset & Change Authentication Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. requestPasswordResetAction', () => {
    it('returns error when email is missing', async () => {
      const formData = new FormData();
      const result = await requestPasswordResetAction(formData);

      expect(result.error).toBe('Email address is required.');
      expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('returns error when email format is invalid', async () => {
      const formData = new FormData();
      formData.set('email', 'not-an-email');
      const result = await requestPasswordResetAction(formData);

      expect(result.error).toBe('Please enter a valid email address.');
      expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('invokes supabase.auth.resetPasswordForEmail with correct redirect URL and returns success message', async () => {
      mockResetPasswordForEmail.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('email', 'user@example.com');
      const result = await requestPasswordResetAction(formData);

      expect(result.success).toBe(true);
      expect(result.message).toContain(
        'If an account exists for this email, we have sent a password reset link',
      );
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          redirectTo: expect.stringContaining(
            '/auth/callback?next=/login/reset-password',
          ),
        }),
      );
    });

    it('returns error message when supabase returns an error', async () => {
      mockResetPasswordForEmail.mockResolvedValueOnce({
        error: { message: 'Rate limit exceeded' },
      });

      const formData = new FormData();
      formData.set('email', 'user@example.com');
      const result = await requestPasswordResetAction(formData);

      expect(result.error).toBe('Rate limit exceeded');
    });
  });

  describe('2. updatePasswordAction', () => {
    it('returns error when password is empty', async () => {
      const formData = new FormData();
      const result = await updatePasswordAction(formData);

      expect(result.error).toBe('New password is required.');
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('returns error when password is less than 6 characters', async () => {
      const formData = new FormData();
      formData.set('password', '12345');
      const result = await updatePasswordAction(formData);

      expect(result.error).toBe('Password must be at least 6 characters long.');
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('returns error when confirmation password does not match', async () => {
      const formData = new FormData();
      formData.set('password', 'newsecret123');
      formData.set('confirmPassword', 'different123');
      const result = await updatePasswordAction(formData);

      expect(result.error).toBe('Passwords do not match.');
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('calls supabase.auth.updateUser and returns success when passwords match', async () => {
      mockUpdateUser.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('password', 'secureNewPass123');
      formData.set('confirmPassword', 'secureNewPass123');
      const result = await updatePasswordAction(formData);

      expect(result.success).toBe(true);
      expect(result.message).toContain(
        'Your password has been successfully updated',
      );
      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: 'secureNewPass123',
      });
    });

    it('returns error when supabase updateUser fails (e.g. session expired)', async () => {
      mockUpdateUser.mockResolvedValueOnce({
        error: { message: 'Auth session missing or expired' },
      });

      const formData = new FormData();
      formData.set('password', 'secureNewPass123');
      formData.set('confirmPassword', 'secureNewPass123');
      const result = await updatePasswordAction(formData);

      expect(result.error).toBe('Auth session missing or expired');
    });
  });

  describe('3. LoginForm Forgot Password Mode', () => {
    it('renders "Forgot password?" button in signin mode and transitions to reset mode', () => {
      render(<LoginForm redirectTo="/profile/taste" defaultMethod="password" />);

      const forgotBtn = screen.getByTestId('forgot-password-link');
      expect(forgotBtn).toBeInTheDocument();
      expect(forgotBtn).toHaveTextContent('Forgot password?');

      fireEvent.click(forgotBtn);

      expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Enter your email address and we will send you a secure link to reset your password.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('password-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Send Reset Link',
      );

      // Back to sign in
      const backBtn = screen.getByTestId('back-to-signin-btn');
      fireEvent.click(backBtn);

      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
      expect(screen.getByTestId('password-input')).toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Sign In',
      );
    });

    it('submits password reset request from LoginForm in forgot_password mode', async () => {
      mockResetPasswordForEmail.mockResolvedValueOnce({ error: null });

      render(<LoginForm redirectTo="/profile/taste" />);

      fireEvent.click(screen.getByTestId('forgot-password-link'));

      const emailInput = screen.getByTestId('email-input');
      fireEvent.change(emailInput, {
        target: { value: 'fan@concerts.test' },
      });

      fireEvent.click(screen.getByTestId('auth-submit-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('auth-success-alert')).toBeInTheDocument();
      });
      expect(screen.getByTestId('auth-success-alert')).toHaveTextContent(
        'password reset link',
      );
    });
  });

  describe('4. ResetPasswordForm Component', () => {
    it('renders inputs and updates password when submitted with matching values', async () => {
      mockUpdateUser.mockResolvedValueOnce({ error: null });

      render(<ResetPasswordForm hasSession={true} />);

      expect(screen.getByText('Change Your Password')).toBeInTheDocument();

      const passInput = screen.getByTestId('new-password-input');
      const confirmInput = screen.getByTestId('confirm-password-input');

      fireEvent.change(passInput, { target: { value: 'mypassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'mypassword123' } });

      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));

      await waitFor(() => {
        expect(
          screen.getByTestId('reset-password-success-alert'),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByTestId('reset-password-success-alert'),
      ).toHaveTextContent('Your password has been successfully updated');
    });

    it('shows error when passwords do not match in ResetPasswordForm', async () => {
      render(<ResetPasswordForm hasSession={true} />);

      const passInput = screen.getByTestId('new-password-input');
      const confirmInput = screen.getByTestId('confirm-password-input');

      fireEvent.change(passInput, { target: { value: 'mypassword123' } });
      fireEvent.change(confirmInput, { target: { value: 'differentpass' } });

      fireEvent.click(screen.getByTestId('reset-password-submit-btn'));

      await waitFor(() => {
        expect(
          screen.getByTestId('reset-password-error-alert'),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByTestId('reset-password-error-alert'),
      ).toHaveTextContent('Passwords do not match.');
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('renders warning notice when no session is present', () => {
      render(<ResetPasswordForm hasSession={false} />);

      expect(
        screen.getByTestId('reset-password-no-session-alert'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('new-password-input'),
      ).not.toBeInTheDocument();
    });
  });

  describe('5. Auth Callback Route Handler (app/auth/callback/route.ts)', () => {
    it('exchanges code for session and redirects to next URL', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=test-auth-code&next=/login/reset-password',
      );
      const response = await authCallbackGet(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('test-auth-code');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login/reset-password',
      );
    });

    it('redirects to login with error message when exchangeCodeForSession fails', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: { message: 'Invalid code' },
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=bad-code',
      );
      const response = await authCallbackGet(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/login?error=');
    });

    it('redirects to login with error message when code is missing', async () => {
      const request = new Request('http://localhost:3000/auth/callback');
      const response = await authCallbackGet(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/login?error=');
    });
  });
});
