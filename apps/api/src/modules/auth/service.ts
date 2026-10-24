import { createHash, randomBytes } from "node:crypto";
import { argon2id, hash, verify, type HashOptions } from "argon2";
import {
  isEmailUniqueViolation,
  type AccountTokenType,
  type AuthUser,
  type UserRepository,
} from "./repository.js";
import type { EmailDeliveryProvider } from "./email-delivery.js";
import type { LoginInput, RegistrationInput } from "./contracts.js";

const ARGON2ID_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const ACCOUNT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

export class EmailDeliveryUnavailableError extends Error {
  constructor() {
    super("Account email delivery is unavailable");
    this.name = "EmailDeliveryUnavailableError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export interface AuthService {
  readonly emailDeliveryConfigured: boolean;
  register(input: RegistrationInput): Promise<void>;
  authenticate(input: LoginInput): Promise<AuthUser>;
  requestVerification(email: string): Promise<void>;
  verifyEmail(token: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<boolean>;
  findActiveUser(id: string): Promise<AuthUser | undefined>;
  suspendUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<"suspended" | "already_inactive" | "missing" | "self">;
}

export class PasswordAuthService implements AuthService {
  private readonly dummyHash = hash(
    randomBytes(32).toString("base64url"),
    ARGON2ID_OPTIONS,
  );

  constructor(
    private readonly users: UserRepository,
    private readonly emailDelivery: EmailDeliveryProvider,
  ) {}

  get emailDeliveryConfigured(): boolean {
    return this.emailDelivery.configured;
  }

  async register(input: RegistrationInput): Promise<void> {
    this.ensureEmailDelivery();
    let user: AuthUser | undefined;
    try {
      const passwordHash = await hash(input.password, ARGON2ID_OPTIONS);
      user = await this.users.createCustomer(input.email, passwordHash);
    } catch (error) {
      if (!isEmailUniqueViolation(error)) {
        throw error;
      }
      user = await this.users.findByEmail(input.email);
    }

    if (user && user.status === "active" && !user.emailVerifiedAt) {
      await this.sendAccountToken(user, "email_verification");
    }
  }

  async authenticate(input: LoginInput): Promise<AuthUser> {
    const user = await this.users.findByEmail(input.email);
    const passwordHash = user?.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await verify(passwordHash, input.password);

    if (
      !user ||
      !passwordMatches ||
      user.status !== "active" ||
      !user.emailVerifiedAt
    ) {
      throw new InvalidCredentialsError();
    }
    return user;
  }

  async requestVerification(email: string): Promise<void> {
    this.ensureEmailDelivery();
    const user = await this.users.findByEmail(email);
    if (user && user.status === "active" && !user.emailVerifiedAt) {
      await this.sendAccountToken(user, "email_verification");
    }
  }

  async verifyEmail(token: string): Promise<boolean> {
    return this.users.verifyEmail(hashToken(token), new Date());
  }

  async requestPasswordReset(email: string): Promise<void> {
    this.ensureEmailDelivery();
    const user = await this.users.findByEmail(email);
    if (user && user.status === "active" && user.emailVerifiedAt) {
      await this.sendAccountToken(user, "password_reset");
    }
  }

  async resetPassword(token: string, password: string): Promise<boolean> {
    const passwordHash = await hash(password, ARGON2ID_OPTIONS);
    return this.users.resetPassword(hashToken(token), passwordHash, new Date());
  }

  async findActiveUser(id: string): Promise<AuthUser | undefined> {
    const user = await this.users.findById(id);
    return user?.status === "active" ? user : undefined;
  }

  async suspendUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<"suspended" | "already_inactive" | "missing" | "self"> {
    return this.users.suspendUser(actorUserId, targetUserId);
  }

  private ensureEmailDelivery(): void {
    if (!this.emailDelivery.configured) {
      throw new EmailDeliveryUnavailableError();
    }
  }

  private async sendAccountToken(
    user: AuthUser,
    type: AccountTokenType,
  ): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ACCOUNT_TOKEN_LIFETIME_MS);
    await this.users.createAccountToken(
      user.id,
      type,
      hashToken(token),
      expiresAt,
    );

    if (type === "email_verification") {
      await this.emailDelivery.sendVerificationEmail({
        email: user.email,
        token,
      });
      return;
    }
    await this.emailDelivery.sendPasswordResetEmail({
      email: user.email,
      token,
    });
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
