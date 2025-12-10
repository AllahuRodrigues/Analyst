'use client';

import './globals.css';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, useScroll, useTransform } from 'framer-motion';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const { scrollY } = useScroll();
  
  const navOpacity = useTransform(scrollY, [0, 100], [0.6, 0.95]);
  const navBlur = useTransform(scrollY, [0, 100], [10, 20]);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Don't show navigation on auth pages, landing page, or dashboard
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isLandingPage = pathname === '/';
  const isDashboard = pathname === '/dashboard';
  const showNav = !isAuthPage && !isLandingPage && !isDashboard;

  return (
    <html lang="en">
      <head>
        <title>DCF Valuation Tool - Financial Modeling for IB</title>
        <meta name="description" content="Professional financial modeling and DCF valuation tools for investment banking" />
      </head>
      <body className="bg-black">
        {showNav && (
          <motion.nav
            style={{
              opacity: navOpacity,
              backdropFilter: `blur(${navBlur}px)`,
            }}
            className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-[95%] max-w-6xl bg-zinc-900/60 border border-white/10 rounded-2xl shadow-2xl"
          >
            <div className="px-6">
              <div className="flex justify-between items-center h-16">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center gap-8"
                >
                  <Link href="/" className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
                    Financial Modeling
                  </Link>
                  <div className="hidden md:flex items-center gap-6">
                    <Link
                      href="/demo"
                      className={`text-sm font-medium transition-colors ${
                        pathname === '/demo'
                          ? 'text-white'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      Demo
                    </Link>
                    {user && (
                      <Link
                        href="/dashboard"
                        className={`text-sm font-medium transition-colors ${
                          pathname === '/dashboard'
                            ? 'text-white'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        Dashboard
                      </Link>
                    )}
                  </div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center gap-4"
                >
                  {user ? (
                    <>
                      <span className="text-gray-400 text-sm hidden sm:inline">{user.email}</span>
                      <button
                        onClick={async () => {
                          await supabase.auth.signOut();
                          window.location.href = '/';
                        }}
                        className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-all text-sm"
                      >
                        Sign Out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        className="px-4 py-2 text-white hover:text-gray-300 transition-colors text-sm"
                      >
                        Login
                      </Link>
                      <Link
                        href="/signup"
                        className="px-4 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-all text-sm"
                      >
                        Sign Up
                      </Link>
                    </>
                  )}
                </motion.div>
              </div>
            </div>
          </motion.nav>
        )}
        <div className={showNav ? 'pt-24' : ''}>
          {children}
        </div>
      </body>
    </html>
  );
}
