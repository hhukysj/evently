import { randomUUID } from "node:crypto";

export interface VerificationEmail {
  email: string;
  token: string;
}

export interface PasswordResetEmail {
  email: string;
  token: string;
}

export interface EmailDeliveryProvider {
  readonly configured: boolean;
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
  sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}

export interface DevelopmentEmailMessage {
  id: string;
  type: "email_verification" | "password_reset";
  email: string;
  token: string;
  createdAt: string;
}

export interface DevelopmentEmailInbox {
  listMessages(): DevelopmentEmailMessage[];
}

export class DevelopmentEmailDelivery implements EmailDeliveryProvider {
  readonly configured = true;
  private readonly messages: DevelopmentEmailMessage[] = [];

  constructor(environment: string) {
    if (environment !== "development") {
      throw new Error("Development email delivery is only available locally");
    }
  }

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    this.capture("email_verification", message);
  }

  async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
    this.capture("password_reset", message);
  }

  listMessages(): DevelopmentEmailMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  private capture(
    type: DevelopmentEmailMessage["type"],
    message: VerificationEmail | PasswordResetEmail,
  ): void {
    this.messages.unshift({
      id: randomUUID(),
      type,
      email: message.email,
      token: message.token,
      createdAt: new Date().toISOString(),
    });
    this.messages.length = Math.min(this.messages.length, 20);
  }
}

export class UnconfiguredEmailDelivery implements EmailDeliveryProvider {
  readonly configured = false;

  async sendVerificationEmail(): Promise<void> {
    throw new Error("Email delivery provider is not configured");
  }

  async sendPasswordResetEmail(): Promise<void> {
    throw new Error("Email delivery provider is not configured");
  }
}
