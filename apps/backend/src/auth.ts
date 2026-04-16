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
import { eq } from 'drizzle-orm';
import { db, DATABASE_PROVIDER } from './db/index.js';
import * as sqliteSchema from './db/schema.js';
import * as pgSchema from './db/schema-pg.js';
import { documents, contributors, versions } from './db/schema.js';

// Use the schema that matches the active database provider so better-auth's
// drizzle adapter sees the correct column types. With the SQLite schema,
// boolean/timestamp columns are declared as integer (mode:'boolean'/timestamp),
// which causes better-auth to emit 0/1 integers and Unix-second integers —
// values that PostgreSQL rejects for boolean and timestamp columns.
const activeSchema = DATABASE_PROVIDER === 'postgresql' ? pgSchema : sqliteSchema;

/** Better-auth instance with email/password + anonymous authentication, cookie-based sessions, and 24hr anonymous user TTL. */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: DATABASE_PROVIDER === 'postgresql' ? 'pg' : 'sqlite',
    schema: {
      ...activeSchema,
      user: activeSchema.users,
      session: activeSchema.sessions,
      account: activeSchema.accounts,
      verification: activeSchema.verifications,
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
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const anonId = anonymousUser.user.id;
        const realId = newUser.user.id;
        // Transfer all documents from anonymous user to the new registered user
        await db.update(documents)
          .set({ ownerId: realId, isAnonymous: false })
          .where(eq(documents.ownerId, anonId));
        // Transfer contributor records (uses agentId field)
        await db.update(contributors)
          .set({ agentId: realId })
          .where(eq(contributors.agentId, anonId));
        // Transfer version authorship
        await db.update(versions)
          .set({ createdBy: realId })
          .where(eq(versions.createdBy, anonId));
      },
    }),
  ],
  trustedOrigins: [
    'https://www.llmtxt.my',
    'https://llmtxt.my',
  ],
});
