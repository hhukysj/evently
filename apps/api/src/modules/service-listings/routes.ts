import { z } from "zod";
import {
  adminServiceListingQuerySchema,
  providerServiceListingQuerySchema,
  publicServiceListingQuerySchema,
  serviceListingInputSchema,
  serviceListingPatchSchema,
} from "@evently/shared";
import { Router, type Request, type Response } from "express";
import { rateLimit, type Store } from "express-rate-limit";
import type { ApiErrorResponse } from "@evently/shared";
import {
  requireAuthentication,
  requireRole,
} from "../../middleware/authorization.js";
import { createCsrfMiddleware } from "../../middleware/csrf.js";
import type { AuthService } from "../auth/service.js";
import type { AuthUser } from "../auth/repository.js";
import type { OwnerServiceListing } from "./repository.js";
import type { ServiceListingService } from "./service.js";

interface ServiceListingRouteConfiguration {
  authService: AuthService;
  service: ServiceListingService;
  appOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  rateLimitStoreFactory?: (scope: string) => Store;
}

const listingIdParamsSchema = z.strictObject({ listingId: z.uuid() });
const hideListingSchema = z.strictObject({
  reason: z.string().trim().min(8).max(500),
});
const emptyActionSchema = z.strictObject({});

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): Response<ApiErrorResponse> {
  return response.status(status).json({
    error: {
      code,
      message,
      requestId: response.locals.requestId as string,
    },
  });
}

function routeRateLimit(
  configuration: ServiceListingRouteConfiguration,
  scope: string,
  limit: number,
) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    passOnStoreError: false,
    standardHeaders: true,
    legacyHeaders: false,
    ...(configuration.rateLimitStoreFactory
      ? { store: configuration.rateLimitStoreFactory(scope) }
      : {}),
    handler: (_request: Request, response: Response) => {
      sendError(
        response,
        429,
        "REQUEST_RATE_LIMITED",
        "Too many attempts. Please try again later.",
      );
    },
  });
}

function etag(listingId: string, version: number): string {
  return `"service-listing:${listingId}:v${version}"`;
}

function sendListing(
  response: Response,
  listing: { id: string; version?: number },
  data: unknown,
  status = 200,
): void {
  if (listing.version !== undefined) {
    response.setHeader("ETag", etag(listing.id, listing.version));
  }
  response.status(status).json({ data });
}

function providerListingData(
  listing: OwnerServiceListing,
): OwnerServiceListing {
  return {
    id: listing.id,
    categorySlug: listing.categorySlug,
    title: listing.title,
    description: listing.description,
    city: listing.city,
    region: listing.region,
    pricingMethod: listing.pricingMethod,
    priceAmountPaise: listing.priceAmountPaise,
    currency: listing.currency,
    publicationStatus: listing.publicationStatus,
    moderationStatus: listing.moderationStatus,
    moderationReason: listing.moderationReason,
    version: listing.version,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

function expectedVersion(
  request: Request,
  response: Response,
  listingId: string,
): number | undefined {
  const header = request.get("If-Match");
  if (!header) {
    sendError(
      response,
      428,
      "PRECONDITION_REQUIRED",
      "A current listing ETag is required",
    );
    return undefined;
  }
  const escapedId = listingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^"service-listing:${escapedId}:v([1-9][0-9]*)"$`,
  ).exec(header);
  const version = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    sendError(
      response,
      412,
      "PRECONDITION_FAILED",
      "The listing ETag is invalid or stale",
    );
    return undefined;
  }
  return version;
}

function parseListingId(request: Request, response: Response) {
  const parsed = listingIdParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendError(response, 400, "INVALID_REQUEST", "Invalid service listing ID");
    return undefined;
  }
  return parsed.data.listingId;
}

function handleMutationFailure(
  response: Response,
  result:
    | "missing"
    | "not_owner"
    | "ineligible"
    | "actor_ineligible"
    | "stale"
    | "hidden"
    | "confirmation_required"
    | "invalid_state",
): void {
  switch (result) {
    case "missing":
    case "not_owner":
      sendError(
        response,
        404,
        "SERVICE_LISTING_NOT_FOUND",
        "Service listing was not found",
      );
      return;
    case "ineligible":
      sendError(
        response,
        403,
        "PROFESSIONAL_NOT_ELIGIBLE",
        "An approved, active professional account is required",
      );
      return;
    case "actor_ineligible":
      sendError(
        response,
        403,
        "ADMIN_ACTION_REJECTED",
        "Administrator access is required",
      );
      return;
    case "stale":
      sendError(
        response,
        412,
        "PRECONDITION_FAILED",
        "The listing changed; reload it and retry",
      );
      return;
    case "hidden":
      sendError(
        response,
        409,
        "SERVICE_LISTING_HIDDEN",
        "A moderated listing cannot be published",
      );
      return;
    case "confirmation_required":
      sendError(
        response,
        428,
        "PUBLISHED_EDIT_CONFIRMATION_REQUIRED",
        "Confirm that you intend to edit a published listing",
      );
      return;
    case "invalid_state":
      sendError(
        response,
        409,
        "INVALID_SERVICE_LISTING_STATE",
        "The requested action is not valid for the current listing state",
      );
  }
}

export function createProviderServiceListingRouter(
  configuration: ServiceListingRouteConfiguration,
) {
  const router = Router();
  const requireAuth = requireAuthentication(
    configuration.authService,
    configuration.cookieName,
    configuration.secureCookies,
  );
  const requireProfessional = requireRole("professional");
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth, requireProfessional);

  router.get("/", async (request, response, next) => {
    const parsed = providerServiceListingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendError(
        response,
        400,
        "INVALID_REQUEST",
        "Invalid service listing page",
      );
      return;
    }
    try {
      const listings = await configuration.service.listOwn(
        (response.locals.authUser as AuthUser).id,
        parsed.data,
      );
      if (listings === "ineligible") {
        sendError(
          response,
          403,
          "PROFESSIONAL_NOT_ELIGIBLE",
          "An approved, active professional account is required",
        );
        return;
      }
      response.json({
        data: {
          listings: listings.listings.map(providerListingData),
          pagination: {
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            total: listings.total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/",
    routeRateLimit(configuration, "service-listing-create", 20),
    csrf,
    async (request, response, next) => {
      const parsed = serviceListingInputSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_SERVICE_LISTING",
          "Check the service listing fields and try again",
        );
        return;
      }
      try {
        const created = await configuration.service.create(
          (response.locals.authUser as AuthUser).id,
          parsed.data,
        );
        if (created === "ineligible") {
          sendError(
            response,
            403,
            "PROFESSIONAL_NOT_ELIGIBLE",
            "An approved, active professional account is required",
          );
          return;
        }
        sendListing(
          response,
          created,
          { listing: providerListingData(created) },
          201,
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/:listingId", async (request, response, next) => {
    const listingId = parseListingId(request, response);
    if (!listingId) {
      return;
    }
    try {
      const listing = await configuration.service.findOwn(
        (response.locals.authUser as AuthUser).id,
        listingId,
      );
      if (listing === "ineligible") {
        sendError(
          response,
          403,
          "PROFESSIONAL_NOT_ELIGIBLE",
          "An approved, active professional account is required",
        );
        return;
      }
      if (!listing) {
        sendError(
          response,
          404,
          "SERVICE_LISTING_NOT_FOUND",
          "Service listing was not found",
        );
        return;
      }
      sendListing(response, listing, {
        listing: providerListingData(listing),
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/:listingId",
    routeRateLimit(configuration, "service-listing-update", 60),
    csrf,
    async (request, response, next) => {
      const listingId = parseListingId(request, response);
      if (!listingId) {
        return;
      }
      const version = expectedVersion(request, response, listingId);
      if (version === undefined) {
        return;
      }
      const parsed = serviceListingPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_SERVICE_LISTING",
          "Check the service listing fields and try again",
        );
        return;
      }
      try {
        const result = await configuration.service.updateOwn(
          (response.locals.authUser as AuthUser).id,
          listingId,
          version,
          parsed.data,
          request.get("X-Confirm-Published-Edit") === "true",
        );
        if (result.type !== "success") {
          handleMutationFailure(response, result.type);
          return;
        }
        sendListing(response, result.listing, {
          listing: providerListingData(result.listing),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ["publish", "unpublish"] as const) {
    router.post(
      `/:listingId/${action}`,
      routeRateLimit(configuration, `service-listing-${action}`, 30),
      csrf,
      async (request, response, next) => {
        const listingId = parseListingId(request, response);
        if (!listingId) {
          return;
        }
        const version = expectedVersion(request, response, listingId);
        if (version === undefined) {
          return;
        }
        if (!emptyActionSchema.safeParse(request.body).success) {
          sendError(response, 400, "INVALID_REQUEST", "Expected an empty body");
          return;
        }
        try {
          const result = await configuration.service.transitionOwn(
            (response.locals.authUser as AuthUser).id,
            listingId,
            version,
            action,
          );
          if (result.type !== "success") {
            handleMutationFailure(response, result.type);
            return;
          }
          sendListing(response, result.listing, {
            listing: providerListingData(result.listing),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}

export function createPublicServiceListingRouter(
  configuration: ServiceListingRouteConfiguration,
) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    "/",
    routeRateLimit(configuration, "service-listing-public-search", 120),
    async (request, response, next) => {
      const parsed = publicServiceListingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_REQUEST",
          "Invalid service listing search",
        );
        return;
      }
      try {
        const result = await configuration.service.listPublic(parsed.data);
        response.json({
          data: {
            listings: result.listings,
            pagination: {
              page: parsed.data.page,
              pageSize: parsed.data.pageSize,
              total: result.total,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:listingId",
    routeRateLimit(configuration, "service-listing-public-detail", 120),
    async (request, response, next) => {
      const listingId = parseListingId(request, response);
      if (!listingId) {
        return;
      }
      try {
        const listing = await configuration.service.findPublic(listingId);
        if (!listing) {
          sendError(
            response,
            404,
            "SERVICE_LISTING_NOT_FOUND",
            "Service listing was not found",
          );
          return;
        }
        response.json({ data: { listing } });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export function createAdminServiceListingRouter(
  configuration: ServiceListingRouteConfiguration,
) {
  const router = Router();
  const requireAuth = requireAuthentication(
    configuration.authService,
    configuration.cookieName,
    configuration.secureCookies,
  );
  const requireAdmin = requireRole("admin");
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth, requireAdmin);

  router.get("/", async (request, response, next) => {
    const parsed = adminServiceListingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendError(
        response,
        400,
        "INVALID_REQUEST",
        "Invalid service listing queue filters",
      );
      return;
    }
    try {
      const result = await configuration.service.listForAdmin(parsed.data);
      response.json({
        data: {
          listings: result.listings,
          pagination: {
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            total: result.total,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:listingId", async (request, response, next) => {
    const listingId = parseListingId(request, response);
    if (!listingId) {
      return;
    }
    try {
      const listing = await configuration.service.findForAdmin(listingId);
      if (!listing) {
        sendError(
          response,
          404,
          "SERVICE_LISTING_NOT_FOUND",
          "Service listing was not found",
        );
        return;
      }
      sendListing(response, listing, { listing });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/:listingId/hide",
    routeRateLimit(configuration, "service-listing-moderation", 30),
    csrf,
    async (request, response, next) => {
      const listingId = parseListingId(request, response);
      if (!listingId) {
        return;
      }
      const version = expectedVersion(request, response, listingId);
      if (version === undefined) {
        return;
      }
      const parsed = hideListingSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_MODERATION_REASON",
          "Provide a moderation reason of at least eight characters",
        );
        return;
      }
      try {
        const result = await configuration.service.moderate(
          listingId,
          (response.locals.authUser as AuthUser).id,
          version,
          "hide",
          parsed.data.reason,
        );
        if (result.type !== "success") {
          handleMutationFailure(response, result.type);
          return;
        }
        sendListing(response, result.listing, { listing: result.listing });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:listingId/restore",
    routeRateLimit(configuration, "service-listing-moderation", 30),
    csrf,
    async (request, response, next) => {
      const listingId = parseListingId(request, response);
      if (!listingId) {
        return;
      }
      const version = expectedVersion(request, response, listingId);
      if (version === undefined) {
        return;
      }
      if (!emptyActionSchema.safeParse(request.body).success) {
        sendError(response, 400, "INVALID_REQUEST", "Expected an empty body");
        return;
      }
      try {
        const result = await configuration.service.moderate(
          listingId,
          (response.locals.authUser as AuthUser).id,
          version,
          "restore",
        );
        if (result.type !== "success") {
          handleMutationFailure(response, result.type);
          return;
        }
        sendListing(response, result.listing, { listing: result.listing });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
