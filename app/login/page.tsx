'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // User is already logged in, redirect to dashboard
        window.location.href = '/dashboard';
        return;
      }
    });

    // Check for error message or verification success in URL params
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get('error');
    const verified = params.get('verified');
    const message = params.get('message');
    let code = params.get('code'); // Email verification code from query params
    
    // Also check hash fragment (Supabase often uses this for PKCE)
    if (!code && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      code = hashParams.get('code') || hashParams.get('access_token');
    }
    
    if (errorMsg) {
      setError(errorMsg);
      setSuccessMessage('');
    }
    
    if (message) {
      setSuccessMessage(message);
      setError('');
    }
    
    // Handle email verification code first (only once)
    if (code) {
      handleEmailVerification(code);
      // Clean URL after handling code
      window.history.replaceState({}, '', '/login');
    } else if (verified === 'true') {
      // Only show this if there's no code to handle
      setSuccessMessage('Email verified successfully! You can now login.');
      setError('');
    }
  }, []);

  const handleEmailVerification = async (code: string) => {
    setLoading(true);
    setError('');
    setSuccessMessage(''); // Clear any existing success message
    
    try {
      // Handle PKCE code (starts with pkce_) - used for email verification
      if (code.startsWith('pkce_')) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          console.error('Verification error:', error);
          // If it's an expired/invalid code, just show message to login
          if (error.message.includes('expired') || error.message.includes('invalid')) {
            setSuccessMessage('This verification link has expired or been used. Please try logging in - your email may already be verified.');
            setError(''); // Clear error
          } else {
            setError(`Verification failed: ${error.message}. Please try logging in.`);
            setSuccessMessage(''); // Clear success
          }
          setLoading(false);
          return;
        }

        // Verification successful, redirect to dashboard
        if (data.session) {
          setSuccessMessage('Email verified successfully! Redirecting to dashboard...');
          setError(''); // Clear any errors
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 500);
          return;
        }
      } else {
        // Non-PKCE code - try using verifyOtp with token_hash (for email verification links)
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: code,
          type: 'email',
        });

        if (error) {
          console.error('Verification error:', error);
          setSuccessMessage('This verification link has expired or been used. Please try logging in - your email may already be verified.');
          setError(''); // Clear error
          setLoading(false);
          return;
        }

        if (data?.session) {
          setSuccessMessage('Email verified successfully! Redirecting to dashboard...');
          setError(''); // Clear any errors
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 500);
          return;
        }
      }

      // If we get here, verification succeeded but no session
      setSuccessMessage('Email verified successfully! You can now login.');
      setError(''); // Clear any errors
      setLoading(false);
    } catch (error: any) {
      console.error('Verification error:', error);
      setSuccessMessage('This verification link may have expired. Please try logging in - your email may already be verified.');
      setError(''); // Clear any errors
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage(''); // Clear success message when attempting login

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.session) {
        // Get user profile to get first name (don't wait for it, just try)
        try {
          await supabase
            .from('profiles')
            .select('first_name')
            .eq('id', data.user.id)
            .single();
        } catch (profileError) {
          // Profile might not exist yet, that's okay
        }

        // Wait a bit to ensure session is fully established
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Force a hard navigation to ensure session cookie is set
        window.location.href = '/dashboard';
      }
    } catch (error: any) {
      setError(error.message || 'Failed to login');
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setResetSent(true);
    } catch (error: any) {
      setError(error.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 border border-white/20">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              {forgotPasswordMode ? 'Reset Password' : 'Welcome Back'}
            </h1>
            <p className="text-gray-300">
              {forgotPasswordMode ? 'Enter your email to receive a reset link' : 'Sign in to your account'}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm">
              {successMessage}
            </div>
          )}

          {resetSent && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm">
              Password reset email sent! Please check your email and click the link to reset your password.
            </div>
          )}

          {!forgotPasswordMode ? (
            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-200 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-200 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="button"
                onClick={() => setForgotPasswordMode(true)}
                className="text-sm text-white/70 hover:text-white transition-colors"
              >
                Forgot password?
              </button>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-6">
              <div>
                <label htmlFor="resetEmail" className="block text-sm font-medium text-gray-200 mb-2">
                  Email Address
                </label>
                <input
                  id="resetEmail"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading || resetSent}
                className="w-full py-3 px-4 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
              >
                {loading ? 'Sending...' : resetSent ? 'Email Sent!' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setForgotPasswordMode(false);
                  setResetSent(false);
                  setResetEmail('');
                  setError('');
                }}
                className="w-full text-sm text-white/70 hover:text-white transition-colors"
              >
                Back to login
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-gray-300 text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="text-white hover:text-gray-300 font-semibold">
                Sign up
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-gray-400 hover:text-gray-300 text-sm">
              ← Back to home
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

