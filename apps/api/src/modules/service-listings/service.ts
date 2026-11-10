import type {
  AdminServiceListingQuery,
  ProviderServiceListingQuery,
  PublicServiceListingQuery,
  ServiceListingInput,
  ServiceListingPatch,
} from "@evently/shared";
import {
  type ListingMutationResult,
  PostgresServiceListingRepository,
} from "./repository.js";

export class ServiceListingService {
  constructor(private readonly listings: PostgresServiceListingRepository) {}

  listOwn(userId: string, query: ProviderServiceListingQuery) {
    return this.listings.listOwn(userId, query);
  }

  create(userId: string, input: ServiceListingInput) {
    return this.listings.create(userId, input);
  }

  findOwn(userId: string, listingId: string) {
    return this.listings.findOwn(userId, listingId);
  }

  findForAdmin(listingId: string) {
    return this.listings.findForAdmin(listingId);
  }

  listForAdmin(query: AdminServiceListingQuery) {
    return this.listings.listForAdmin(query);
  }

  updateOwn(
    userId: string,
    listingId: string,
    expectedVersion: number,
    input: ServiceListingPatch,
    confirmPublishedEdit: boolean,
  ): Promise<ListingMutationResult> {
    return this.listings.updateOwn(
      userId,
      listingId,
      expectedVersion,
      input,
      confirmPublishedEdit,
    );
  }

  transitionOwn(
    userId: string,
    listingId: string,
    expectedVersion: number,
    action: "publish" | "unpublish",
  ): Promise<ListingMutationResult> {
    return this.listings.transitionOwn(
      userId,
      listingId,
      expectedVersion,
      action,
    );
  }

  moderate(
    listingId: string,
    actorUserId: string,
    expectedVersion: number,
    action: "hide" | "restore",
    reason?: string,
  ): Promise<ListingMutationResult> {
    return this.listings.moderate(
      listingId,
      actorUserId,
      expectedVersion,
      action,
      reason,
    );
  }

  listPublic(query: PublicServiceListingQuery) {
    return this.listings.listPublic(query);
  }

  findPublic(listingId: string) {
    return this.listings.findPublic(listingId);
  }
}
