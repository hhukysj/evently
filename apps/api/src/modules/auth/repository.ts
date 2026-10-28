import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  accountTokens,
  adminAuditLogs,
  sessions,
  users,
} from "../../db/schema.js";

export type UserRole = "customer" | "professional" | "admin";
export type UserStatus = "active" | "suspended" | "deactivated";
export type AccountTokenType = "email_verification" | "password_reset";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  authVersion: number;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<AuthUser | undefined>;
  findById(id: string): Promise<AuthUser | undefined>;
  createCustomer(email: string, passwordHash: string): Promise<AuthUser>;
  createAccountToken(
    userId: string,
    type: AccountTokenType,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  verifyEmail(tokenHash: string, now: Date): Promise<boolean>;
  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean>;
  suspendUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<"suspended" | "already_inactive" | "missing" | "self">;
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const [user] = await this.database
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    return user;
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const [user] = await this.database
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }

  async createCustomer(email: string, passwordHash: string): Promise<AuthUser> {
    const [user] = await this.database
      .insert(users)
      .values({
        email,
        passwordHash,
        role: "customer",
      })
      .returning();

    if (!user) {
      throw new Error("User insert returned no record");
    }
    return user;
  }

  async createAccountToken(
    userId: string,
    type: AccountTokenType,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .delete(accountTokens)
        .where(
          and(
            eq(accountTokens.userId, userId),
            eq(accountTokens.type, type),
            isNull(accountTokens.consumedAt),
          ),
        );
      await transaction.insert(accountTokens).values({
        userId,
        type,
        tokenHash,
        expiresAt,
      });
    });
  }

  async verifyEmail(tokenHash: string, now: Date): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [token] = await transaction
        .update(accountTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(accountTokens.tokenHash, tokenHash),
            eq(accountTokens.type, "email_verification"),
            isNull(accountTokens.consumedAt),
            sql`${accountTokens.expiresAt} > ${now}`,
          ),
        )
        .returning({ userId: accountTokens.userId });
      if (!token) {
        return false;
      }

      const verified = await transaction
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(
          and(
            eq(users.id, token.userId),
            eq(users.status, "active"),
            isNull(users.emailVerifiedAt),
          ),
        )
        .returning({ id: users.id });
      return verified.length === 1;
    });
  }

  async resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [token] = await transaction
        .update(accountTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(accountTokens.tokenHash, tokenHash),
            eq(accountTokens.type, "password_reset"),
            isNull(accountTokens.consumedAt),
            sql`${accountTokens.expiresAt} > ${now}`,
          ),
        )
        .returning({ userId: accountTokens.userId });
      if (!token) {
        return false;
      }

      const updated = await transaction
        .update(users)
        .set({
          passwordHash,
          authVersion: sql`${users.authVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(users.id, token.userId),
            eq(users.status, "active"),
            sql`${users.emailVerifiedAt} IS NOT NULL`,
          ),
        )
        .returning({ id: users.id });
      if (updated.length !== 1) {
        return false;
      }

      await transaction
        .delete(sessions)
        .where(sql`${sessions.sess}->>'userId' = ${token.userId}`);
      await transaction
        .update(accountTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(accountTokens.userId, token.userId),
            eq(accountTokens.type, "password_reset"),
            isNull(accountTokens.consumedAt),
          ),
        );
      return true;
    });
  }

  async suspendUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<"suspended" | "already_inactive" | "missing" | "self"> {
    if (actorUserId === targetUserId) {
      return "self";
    }

    return this.database.transaction(async (transaction) => {
      const [target] = await transaction
        .update(users)
        .set({
          status: "suspended",
          authVersion: sql`${users.authVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, targetUserId), eq(users.status, "active")))
        .returning({ id: users.id });
      if (!target) {
        const [existing] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        return existing ? "already_inactive" : "missing";
      }

      await transaction
        .delete(sessions)
        .where(sql`${sessions.sess}->>'userId' = ${targetUserId}`);
      await transaction.insert(adminAuditLogs).values({
        actorUserId,
        targetUserId,
        action: "suspend_user",
      });
      return "suspended";
    });
  }
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export function isEmailUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "users_email_unique"
  );
}
