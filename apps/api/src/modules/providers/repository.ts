import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  adminAuditLogs,
  professionalProfileTypes,
  professionalProfiles,
  providerApplicationTypes,
  providerApplications,
  sessions,
  users,
} from "../../db/schema.js";
import type {
  ProfessionalProfilePatch,
  ProviderApplicationInput,
  ProviderApplicationQuery,
  ProviderApplicationStatus,
  ProviderType,
} from "./contracts.js";

export interface ApplicantApplication {
  id: string;
  displayName: string;
  description: string;
  city: string;
  region: string | null;
  country: string;
  providerTypes: ProviderType[];
  status: ProviderApplicationStatus;
  createdAt: Date;
}

export interface AdminApplication extends ApplicantApplication {
  applicant: { id: string; email: string };
  reviewerUserId: string | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
}

export interface ProfessionalProfile {
  id: string;
  displayName: string;
  slug: string;
  headline: string | null;
  bio: string | null;
  city: string;
  region: string | null;
  country: string;
  status: "draft";
  providerTypes: ProviderType[];
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationReviewResult =
  "approved" | "rejected" | "missing" | "not_pending" | "not_eligible";

export interface ProviderRepository {
  createApplication(
    userId: string,
    input: ProviderApplicationInput,
  ): Promise<"created" | "pending_exists">;
  findLatestApplicationForUser(
    userId: string,
  ): Promise<ApplicantApplication | undefined>;
  listApplications(
    query: ProviderApplicationQuery,
  ): Promise<{ applications: AdminApplication[]; total: number }>;
  findApplicationForAdmin(id: string): Promise<AdminApplication | undefined>;
  reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    action: { type: "approve" },
  ): Promise<"approved" | "missing" | "not_pending" | "not_eligible">;
  reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    action: { type: "reject"; reason: string },
  ): Promise<"rejected" | "missing" | "not_pending">;
  findProfessionalProfile(
    userId: string,
  ): Promise<ProfessionalProfile | undefined>;
  updateProfessionalProfile(
    userId: string,
    input: ProfessionalProfilePatch,
    now: Date,
  ): Promise<ProfessionalProfile | undefined>;
}

function isPendingApplicationViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "provider_applications_one_pending_per_user"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return false;
}

function makeSlug(displayName: string, userId: string): string {
  const prefix =
    displayName
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "professional";
  return `${prefix}-${userId}`;
}

async function applicationTypes(
  database: NodePgDatabase<typeof schema>,
  applicationId: string,
): Promise<ProviderType[]> {
  const rows = await database
    .select({ providerType: providerApplicationTypes.providerType })
    .from(providerApplicationTypes)
    .where(eq(providerApplicationTypes.applicationId, applicationId));
  return rows.map(({ providerType }) => providerType);
}

async function profileTypes(
  database: NodePgDatabase<typeof schema>,
  profileId: string,
): Promise<ProviderType[]> {
  const rows = await database
    .select({ providerType: professionalProfileTypes.providerType })
    .from(professionalProfileTypes)
    .where(eq(professionalProfileTypes.profileId, profileId));
  return rows.map(({ providerType }) => providerType);
}

export class PostgresProviderRepository implements ProviderRepository {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async createApplication(
    userId: string,
    input: ProviderApplicationInput,
  ): Promise<"created" | "pending_exists"> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [owner] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        if (!owner) {
          throw new Error("Provider application owner no longer exists");
        }
        const [pending] = await transaction
          .select({ id: providerApplications.id })
          .from(providerApplications)
          .where(
            and(
              eq(providerApplications.userId, userId),
              eq(providerApplications.status, "pending"),
            ),
          )
          .limit(1);
        if (pending) {
          return "pending_exists";
        }
        const [application] = await transaction
          .insert(providerApplications)
          .values({
            userId,
            displayName: input.displayName,
            description: input.description,
            city: input.city,
            region: input.region || null,
            country: input.country,
          })
          .returning({ id: providerApplications.id });
        if (!application) {
          throw new Error("Provider application insert returned no record");
        }
        await transaction.insert(providerApplicationTypes).values(
          input.providerTypes.map((providerType) => ({
            applicationId: application.id,
            providerType,
          })),
        );
        return "created";
      });
    } catch (error) {
      if (isPendingApplicationViolation(error)) {
        return "pending_exists";
      }
      throw error;
    }
  }

  async findLatestApplicationForUser(
    userId: string,
  ): Promise<ApplicantApplication | undefined> {
    const [application] = await this.database
      .select()
      .from(providerApplications)
      .where(eq(providerApplications.userId, userId))
      .orderBy(
        desc(providerApplications.createdAt),
        desc(providerApplications.id),
      )
      .limit(1);
    if (!application) {
      return undefined;
    }
    return {
      id: application.id,
      displayName: application.displayName,
      description: application.description,
      city: application.city,
      region: application.region,
      country: application.country,
      providerTypes: await applicationTypes(this.database, application.id),
      status: application.status,
      createdAt: application.createdAt,
    };
  }

  async listApplications(
    query: ProviderApplicationQuery,
  ): Promise<{ applications: AdminApplication[]; total: number }> {
    const filter = query.status
      ? eq(providerApplications.status, query.status)
      : undefined;
    const where = filter ? and(filter) : undefined;
    const [countResult] = await this.database
      .select({ total: count() })
      .from(providerApplications)
      .where(where);
    const rows = await this.database
      .select({
        application: providerApplications,
        applicantId: users.id,
        applicantEmail: users.email,
      })
      .from(providerApplications)
      .innerJoin(users, eq(users.id, providerApplications.userId))
      .where(where)
      .orderBy(
        desc(providerApplications.createdAt),
        desc(providerApplications.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const ids = rows.map(({ application }) => application.id);
    const typeRows =
      ids.length > 0
        ? await this.database
            .select({
              applicationId: providerApplicationTypes.applicationId,
              providerType: providerApplicationTypes.providerType,
            })
            .from(providerApplicationTypes)
            .where(inArray(providerApplicationTypes.applicationId, ids))
        : [];
    const typesByApplication = new Map<string, ProviderType[]>();
    for (const row of typeRows) {
      const types = typesByApplication.get(row.applicationId) ?? [];
      types.push(row.providerType);
      typesByApplication.set(row.applicationId, types);
    }
    return {
      applications: rows.map(({ application, applicantId, applicantEmail }) =>
        this.toAdminApplication(
          application,
          { id: applicantId, email: applicantEmail },
          typesByApplication.get(application.id) ?? [],
        ),
      ),
      total: Number(countResult?.total ?? 0),
    };
  }

  async findApplicationForAdmin(
    id: string,
  ): Promise<AdminApplication | undefined> {
    const [row] = await this.database
      .select({
        application: providerApplications,
        applicantId: users.id,
        applicantEmail: users.email,
      })
      .from(providerApplications)
      .innerJoin(users, eq(users.id, providerApplications.userId))
      .where(eq(providerApplications.id, id))
      .limit(1);
    if (!row) {
      return undefined;
    }
    return this.toAdminApplication(
      row.application,
      { id: row.applicantId, email: row.applicantEmail },
      await applicationTypes(this.database, id),
    );
  }

  reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    action: { type: "approve" },
  ): Promise<"approved" | "missing" | "not_pending" | "not_eligible">;
  reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    action: { type: "reject"; reason: string },
  ): Promise<"rejected" | "missing" | "not_pending">;
  async reviewApplication(
    applicationId: string,
    reviewerUserId: string,
    action: { type: "approve" } | { type: "reject"; reason: string },
  ): Promise<ApplicationReviewResult> {
    return this.database.transaction(async (transaction) => {
      const [application] = await transaction
        .select()
        .from(providerApplications)
        .where(eq(providerApplications.id, applicationId))
        .for("update");
      if (!application) {
        return "missing";
      }
      if (application.status !== "pending") {
        return "not_pending";
      }

      const now = new Date();
      if (action.type === "reject") {
        await transaction
          .update(providerApplications)
          .set({
            status: "rejected",
            reviewerUserId,
            rejectionReason: action.reason,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(providerApplications.id, applicationId),
              eq(providerApplications.status, "pending"),
            ),
          );
        await transaction.insert(adminAuditLogs).values({
          actorUserId: reviewerUserId,
          targetUserId: application.userId,
          providerApplicationId: applicationId,
          action: "reject_provider_application",
        });
        return "rejected";
      }

      const [promotedUser] = await transaction
        .update(users)
        .set({
          role: "professional",
          authVersion: sql`${users.authVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(users.id, application.userId),
            eq(users.role, "customer"),
            eq(users.status, "active"),
            sql`${users.emailVerifiedAt} IS NOT NULL`,
          ),
        )
        .returning({ id: users.id });
      if (!promotedUser) {
        return "not_eligible";
      }

      const [profile] = await transaction
        .insert(professionalProfiles)
        .values({
          userId: application.userId,
          displayName: application.displayName,
          slug: makeSlug(application.displayName, application.userId),
          bio: application.description,
          city: application.city,
          region: application.region,
          country: application.country,
          status: "draft",
        })
        .returning({ id: professionalProfiles.id });
      if (!profile) {
        throw new Error("Professional profile insert returned no record");
      }

      const types = await transaction
        .select({ providerType: providerApplicationTypes.providerType })
        .from(providerApplicationTypes)
        .where(eq(providerApplicationTypes.applicationId, applicationId));
      if (types.length === 0) {
        throw new Error("Provider application has no provider types");
      }
      await transaction.insert(professionalProfileTypes).values(
        types.map(({ providerType }) => ({
          profileId: profile.id,
          providerType,
        })),
      );

      await transaction
        .update(providerApplications)
        .set({
          status: "approved",
          reviewerUserId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(providerApplications.id, applicationId),
            eq(providerApplications.status, "pending"),
          ),
        );
      await transaction
        .delete(sessions)
        .where(sql`${sessions.sess}->>'userId' = ${application.userId}`);
      await transaction.insert(adminAuditLogs).values({
        actorUserId: reviewerUserId,
        targetUserId: application.userId,
        providerApplicationId: applicationId,
        action: "approve_provider_application",
      });
      return "approved";
    });
  }

  async findProfessionalProfile(
    userId: string,
  ): Promise<ProfessionalProfile | undefined> {
    const [profile] = await this.database
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, userId))
      .limit(1);
    if (!profile) {
      return undefined;
    }
    return this.toProfessionalProfile(
      profile,
      await profileTypes(this.database, profile.id),
    );
  }

  async updateProfessionalProfile(
    userId: string,
    input: ProfessionalProfilePatch,
    now: Date,
  ): Promise<ProfessionalProfile | undefined> {
    const [profile] = await this.database
      .update(professionalProfiles)
      .set({ ...input, updatedAt: now })
      .where(eq(professionalProfiles.userId, userId))
      .returning();
    if (!profile) {
      return undefined;
    }
    return this.toProfessionalProfile(
      profile,
      await profileTypes(this.database, profile.id),
    );
  }

  private toAdminApplication(
    application: typeof providerApplications.$inferSelect,
    applicant: { id: string; email: string },
    types: ProviderType[],
  ): AdminApplication {
    return {
      id: application.id,
      displayName: application.displayName,
      description: application.description,
      city: application.city,
      region: application.region,
      country: application.country,
      providerTypes: types,
      status: application.status,
      createdAt: application.createdAt,
      applicant,
      reviewerUserId: application.reviewerUserId,
      rejectionReason: application.rejectionReason,
      reviewedAt: application.reviewedAt,
    };
  }

  private toProfessionalProfile(
    profile: typeof professionalProfiles.$inferSelect,
    types: ProviderType[],
  ): ProfessionalProfile {
    return {
      id: profile.id,
      displayName: profile.displayName,
      slug: profile.slug,
      headline: profile.headline,
      bio: profile.bio,
      city: profile.city,
      region: profile.region,
      country: profile.country,
      status: profile.status,
      providerTypes: types,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
