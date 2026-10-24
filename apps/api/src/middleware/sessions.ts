import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import type { Request } from "express";
import type { Pool } from "pg";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export interface AuthSession extends session.Session {
  userId?: string;
  csrfToken?: string;
}

export function authSession(request: Request): AuthSession {
  return request.session as AuthSession;
}

export interface SessionConfiguration {
  secret: string;
  secureCookies: boolean;
  store: session.Store;
}

export interface PostgresSessionStore extends session.Store {
  close(): void;
}

export function sessionCookieName(secureCookies: boolean): string {
  return secureCookies ? "__Host-evently.sid" : "evently.sid";
}

export function createPostgresSessionStore(pool: Pool): PostgresSessionStore {
  const PostgresStore = connectPgSimple(session);
  return new PostgresStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15,
  });
}

export function createSessionMiddleware(configuration: SessionConfiguration) {
  return session({
    name: sessionCookieName(configuration.secureCookies),
    secret: configuration.secret,
    store: configuration.store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: configuration.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_LIFETIME_MS,
    },
  });
}

export function sessionLifetimeMs(): number {
  return SESSION_LIFETIME_MS;
}
