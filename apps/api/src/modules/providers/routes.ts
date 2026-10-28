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
import {
  emptyActionSchema,
  professionalProfilePatchSchema,
  providerApplicationIdParamsSchema,
  providerApplicationQuerySchema,
  providerApplicationSchema,
  rejectProviderApplicationSchema,
} from "./contracts.js";
import type { ProviderService } from "./service.js";

interface ProviderRouteConfiguration {
  authService: AuthService;
  providerService: ProviderService;
  appOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  rateLimitStoreFactory?: (scope: string) => Store;
}

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
  configuration: ProviderRouteConfiguration,
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

function createRequireAuth(configuration: ProviderRouteConfiguration) {
  return requireAuthentication(
    configuration.authService,
    configuration.cookieName,
    configuration.secureCookies,
  );
}

export function createProviderApplicationRouter(
  configuration: ProviderRouteConfiguration,
) {
  const router = Router();
  const requireAuth = createRequireAuth(configuration);
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/",
    routeRateLimit(configuration, "provider-application-submit", 5),
    requireAuth,
    requireRole("customer"),
    csrf,
    async (request, response, next) => {
      const user = response.locals.authUser as AuthUser;
      if (!user.emailVerifiedAt) {
        sendError(
          response,
          403,
          "EMAIL_VERIFICATION_REQUIRED",
          "Verify your email before applying",
        );
        return;
      }
      const parsed = providerApplicationSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_PROVIDER_APPLICATION",
          "Check the application details and try again",
        );
        return;
      }
      try {
        const result = await configuration.providerService.submitApplication(
          user.id,
          parsed.data,
        );
        if (result === "pending_exists") {
          sendError(
            response,
            409,
            "APPLICATION_ALREADY_PENDING",
            "You already have a pending provider application",
          );
          return;
        }
        response.status(201).json({
          data: { status: "pending", message: "Application submitted" },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/me", requireAuth, async (_request, response, next) => {
    try {
      const application = await configuration.providerService.getOwnApplication(
        (response.locals.authUser as AuthUser).id,
      );
      response.json({ data: { application: application ?? null } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createAdminProviderApplicationRouter(
  configuration: ProviderRouteConfiguration,
) {
  const router = Router();
  const requireAuth = createRequireAuth(configuration);
  const requireAdmin = requireRole("admin");
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth, requireAdmin);

  router.get("/", async (request, response, next) => {
    const parsed = providerApplicationQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_REQUEST", "Invalid application query");
      return;
    }
    try {
      const result = await configuration.providerService.listApplications(
        parsed.data,
      );
      response.json({
        data: {
          applications: result.applications,
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

  router.get("/:applicationId", async (request, response, next) => {
    const parsed = providerApplicationIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_REQUEST", "Invalid application ID");
      return;
    }
    try {
      const application =
        await configuration.providerService.getApplicationForAdmin(
          parsed.data.applicationId,
        );
      if (!application) {
        sendError(
          response,
          404,
          "APPLICATION_NOT_FOUND",
          "Provider application was not found",
        );
        return;
      }
      response.json({ data: { application } });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/:applicationId/approve",
    routeRateLimit(configuration, "provider-application-review", 30),
    csrf,
    async (request, response, next) => {
      const params = providerApplicationIdParamsSchema.safeParse(
        request.params,
      );
      if (!params.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid application ID");
        return;
      }
      if (!emptyActionSchema.safeParse(request.body).success) {
        sendError(
          response,
          400,
          "INVALID_REQUEST",
          "Approval requests cannot contain fields",
        );
        return;
      }
      try {
        const result = await configuration.providerService.approveApplication(
          params.data.applicationId,
          (response.locals.authUser as AuthUser).id,
        );
        if (result === "approved") {
          response.json({ data: { status: "approved" } });
          return;
        }
        handleReviewFailure(response, result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:applicationId/reject",
    routeRateLimit(configuration, "provider-application-review", 30),
    csrf,
    async (request, response, next) => {
      const params = providerApplicationIdParamsSchema.safeParse(
        request.params,
      );
      if (!params.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid application ID");
        return;
      }
      const body = rejectProviderApplicationSchema.safeParse(request.body);
      if (!body.success) {
        sendError(
          response,
          400,
          "INVALID_REJECTION_REASON",
          "Provide a rejection reason between 8 and 500 characters",
        );
        return;
      }
      try {
        const result = await configuration.providerService.rejectApplication(
          params.data.applicationId,
          (response.locals.authUser as AuthUser).id,
          body.data.reason,
        );
        if (result === "rejected") {
          response.json({ data: { status: "rejected" } });
          return;
        }
        handleReviewFailure(response, result);
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

export function createProfessionalRouter(
  configuration: ProviderRouteConfiguration,
) {
  const router = Router();
  const requireAuth = createRequireAuth(configuration);
  const requireProfessional = requireRole("professional");
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth, requireProfessional);

  router.get("/me", async (_request, response, next) => {
    try {
      const profile = await configuration.providerService.getOwnProfile(
        (response.locals.authUser as AuthUser).id,
      );
      if (!profile) {
        sendError(
          response,
          404,
          "PROFESSIONAL_PROFILE_NOT_FOUND",
          "Professional profile was not found",
        );
        return;
      }
      response.json({ data: { profile } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/me/profile", csrf, async (request, response, next) => {
    const parsed = professionalProfilePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(
        response,
        400,
        "INVALID_PROFILE",
        "Check the profile fields and try again",
      );
      return;
    }
    try {
      const profile = await configuration.providerService.updateOwnProfile(
        (response.locals.authUser as AuthUser).id,
        parsed.data,
      );
      if (!profile) {
        sendError(
          response,
          404,
          "PROFESSIONAL_PROFILE_NOT_FOUND",
          "Professional profile was not found",
        );
        return;
      }
      response.json({ data: { profile } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function handleReviewFailure(
  response: Response,
  result: "missing" | "not_pending" | "not_eligible",
): void {
  if (result === "missing") {
    sendError(
      response,
      404,
      "APPLICATION_NOT_FOUND",
      "Provider application was not found",
    );
    return;
  }
  if (result === "not_pending") {
    sendError(
      response,
      409,
      "APPLICATION_ALREADY_REVIEWED",
      "Provider application is no longer pending",
    );
    return;
  }
  sendError(
    response,
    409,
    "APPLICANT_NOT_ELIGIBLE",
    "Applicant is not eligible for approval",
  );
}
