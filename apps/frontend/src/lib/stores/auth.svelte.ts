import { api } from '$lib/api/client';
import type { Session } from '$lib/types';

let session = $state<Session>({ user: null });
let loading = $state(true);

export function getAuth() {
  return {
    get session() { return session; },
    get loading() { return loading; },
    get isAuthenticated() { return session.user !== null; },
    get isAnonymous() { return session.user?.isAnonymous ?? false; },

    async init() {
      loading = true;
      try {
        const data = await api.getSession();
        if (data?.session) {
          session = { user: data.session.user };
        } else {
          session = { user: null };
        }
      } catch {
        session = { user: null };
      } finally {
        loading = false;
      }
    },

    async signIn(email: string, password: string) {
      const data = await api.signIn(email, password);
      if (data?.user) {
        session = { user: data.user };
      }
      return data;
    },

    async signUp(email: string, password: string, name?: string) {
      const data = await api.signUp(email, password, name);
      if (data?.user) {
        session = { user: data.user };
      }
      return data;
    },

    async signInAnonymous() {
      const data = await api.signInAnonymous();
      if (data?.user) {
        session = { user: { ...data.user, isAnonymous: true } };
      }
      return data;
    },

    async signOut() {
      await api.signOut();
      session = { user: null };
    },
  };
}
