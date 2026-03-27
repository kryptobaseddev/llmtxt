/**
 * Authentication configuration using better-auth.
 *
 * Supports anonymous users (24hr TTL, auto-purge) and
 * registered users (email/password). Cookie-based sessions.
 */
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 min cache
    },
  },
  plugins: [
    anonymous({
      emailDomainName: 'anon.llmtxt.my',
    }),
  ],
});
