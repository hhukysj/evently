import type {
  ProfessionalProfilePatch,
  ProviderApplicationInput,
  ProviderApplicationQuery,
} from "./contracts.js";
import type {
  AdminApplication,
  ApplicantApplication,
  ProfessionalProfile,
  ProviderRepository,
} from "./repository.js";

export interface ProviderService {
  submitApplication(
    userId: string,
    input: ProviderApplicationInput,
  ): Promise<"created" | "pending_exists">;
  getOwnApplication(userId: string): Promise<ApplicantApplication | undefined>;
  listApplications(
    query: ProviderApplicationQuery,
  ): Promise<{ applications: AdminApplication[]; total: number }>;
  getApplicationForAdmin(id: string): Promise<AdminApplication | undefined>;
  approveApplication(
    applicationId: string,
    reviewerUserId: string,
  ): Promise<"approved" | "missing" | "not_pending" | "not_eligible">;
  rejectApplication(
    applicationId: string,
    reviewerUserId: string,
    reason: string,
  ): Promise<"rejected" | "missing" | "not_pending">;
  getOwnProfile(userId: string): Promise<ProfessionalProfile | undefined>;
  updateOwnProfile(
    userId: string,
    input: ProfessionalProfilePatch,
  ): Promise<ProfessionalProfile | undefined>;
}

export class MarketplaceProviderService implements ProviderService {
  constructor(private readonly providers: ProviderRepository) {}

  submitApplication(
    userId: string,
    input: ProviderApplicationInput,
  ): Promise<"created" | "pending_exists"> {
    return this.providers.createApplication(userId, input);
  }

  getOwnApplication(userId: string): Promise<ApplicantApplication | undefined> {
    return this.providers.findLatestApplicationForUser(userId);
  }

  listApplications(query: ProviderApplicationQuery) {
    return this.providers.listApplications(query);
  }

  getApplicationForAdmin(id: string): Promise<AdminApplication | undefined> {
    return this.providers.findApplicationForAdmin(id);
  }

  approveApplication(
    applicationId: string,
    reviewerUserId: string,
  ): Promise<"approved" | "missing" | "not_pending" | "not_eligible"> {
    return this.providers.reviewApplication(applicationId, reviewerUserId, {
      type: "approve",
    });
  }

  rejectApplication(
    applicationId: string,
    reviewerUserId: string,
    reason: string,
  ): Promise<"rejected" | "missing" | "not_pending"> {
    return this.providers.reviewApplication(applicationId, reviewerUserId, {
      type: "reject",
      reason,
    });
  }

  getOwnProfile(userId: string): Promise<ProfessionalProfile | undefined> {
    return this.providers.findProfessionalProfile(userId);
  }

  updateOwnProfile(
    userId: string,
    input: ProfessionalProfilePatch,
  ): Promise<ProfessionalProfile | undefined> {
    return this.providers.updateProfessionalProfile(userId, input, new Date());
  }
}
