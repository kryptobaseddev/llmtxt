/**
 * Authentication configuration using better-auth.
 *
 * Supports anonymous users (24hr TTL, auto-purge) and
 * registered users (email/password). Cookie-based sessions.
 *
 * better-auth manages its own user/session/account/verification tables.
 * We pass the Drizzle schema with the user→users mapping so it finds
 * our plural table names.
 */
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';
import * as schema from './db/schema.js';

/** Better-auth instance with email/password + anonymous authentication, cookie-based sessions, and 24hr anonymous user TTL. */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      ...schema,
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
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
  trustedOrigins: [
    'https://www.llmtxt.my',
    'https://llmtxt.my',
  ],
});
