import {
  bookingRequestCreationInputSchema,
  customerBookingRequestListQuerySchema,
  markNotificationReadInputSchema,
  notificationListQuerySchema,
  providerBookingRequestListQuerySchema,
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
import { isBookingConstraintError } from "./repository.js";
import type { BookingService } from "./service.js";
import { z } from "zod";

interface BookingRouteConfiguration {
  authService: AuthService;
  bookingService: BookingService;
  appOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  rateLimitStoreFactory?: (scope: string) => Store;
}

const requestParamsSchema = z.strictObject({ requestId: z.uuid() });
const notificationParamsSchema = z.strictObject({ notificationId: z.uuid() });
const emptyActionInputSchema = z.strictObject({});

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
  configuration: BookingRouteConfiguration,
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

function parseRequestId(request: Request, response: Response) {
  const parsed = requestParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    sendError(response, 400, "INVALID_REQUEST", "Invalid booking request ID");
    return undefined;
  }
  return parsed.data.requestId;
}

function handleConstraintError(error: unknown, response: Response): boolean {
  if (!isBookingConstraintError(error)) {
    return false;
  }
  sendError(
    response,
    409,
    "BOOKING_REQUEST_CONSTRAINT_FAILED",
    "The booking request could not be completed",
  );
  return true;
}

function commonMiddleware(
  router: ReturnType<typeof Router>,
  configuration: BookingRouteConfiguration,
): void {
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(
    requireAuthentication(
      configuration.authService,
      configuration.cookieName,
      configuration.secureCookies,
    ),
  );
}

export function createCustomerBookingRequestRouter(
  configuration: BookingRouteConfiguration,
) {
  const router = Router();
  commonMiddleware(router, configuration);
  router.use(requireRole("customer"));
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.get(
    "/me",
    routeRateLimit(configuration, "booking-request-customer-list", 120),
    async (request, response, next) => {
      const parsed = customerBookingRequestListQuerySchema.safeParse(
        request.query,
      );
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid booking filters");
        return;
      }
      try {
        const page = await configuration.bookingService.listCustomerRequests(
          (response.locals.authUser as AuthUser).id,
          parsed.data,
        );
        response.json({
          data: {
            bookingRequests: page.bookingRequests,
            pagination: {
              page: parsed.data.page,
              pageSize: parsed.data.pageSize,
              total: page.total,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/",
    routeRateLimit(configuration, "booking-request-create", 10),
    csrf,
    async (request, response, next) => {
      const user = response.locals.authUser as AuthUser;
      if (!user.emailVerifiedAt) {
        sendError(
          response,
          403,
          "EMAIL_VERIFICATION_REQUIRED",
          "Verify your email before requesting a service",
        );
        return;
      }
      const parsed = bookingRequestCreationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_BOOKING_REQUEST",
          "Check the event brief and try again",
        );
        return;
      }
      try {
        const result = await configuration.bookingService.createRequest(
          user.id,
          parsed.data,
        );
        switch (result.type) {
          case "created":
          case "replayed":
            response.status(result.type === "created" ? 201 : 200).json({
              data: { bookingRequest: result.bookingRequest },
            });
            return;
          case "customer_ineligible":
            sendError(
              response,
              403,
              "CUSTOMER_NOT_ELIGIBLE",
              "An active, verified customer account is required",
            );
            return;
          case "unavailable_listing":
            sendError(
              response,
              404,
              "SERVICE_LISTING_NOT_FOUND",
              "Service listing was not found",
            );
            return;
          case "self_request":
            sendError(
              response,
              409,
              "SELF_REQUEST_NOT_ALLOWED",
              "You cannot request your own service",
            );
            return;
          case "idempotency_conflict":
            sendError(
              response,
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "This request key was already used with different details",
            );
        }
      } catch (error) {
        if (handleConstraintError(error, response)) {
          return;
        }
        next(error);
      }
    },
  );

  router.get("/:requestId", async (request, response, next) => {
    const requestId = parseRequestId(request, response);
    if (!requestId) {
      return;
    }
    try {
      const bookingRequest =
        await configuration.bookingService.findCustomerRequest(
          (response.locals.authUser as AuthUser).id,
          requestId,
        );
      if (!bookingRequest) {
        sendError(
          response,
          404,
          "BOOKING_REQUEST_NOT_FOUND",
          "Booking request was not found",
        );
        return;
      }
      response.json({ data: { bookingRequest } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createProfessionalBookingRequestRouter(
  configuration: BookingRouteConfiguration,
) {
  const router = Router();
  commonMiddleware(router, configuration);
  router.use(requireRole("professional"));
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.get(
    "/",
    routeRateLimit(configuration, "booking-request-professional-list", 120),
    async (request, response, next) => {
      const parsed = providerBookingRequestListQuerySchema.safeParse(
        request.query,
      );
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid booking filters");
        return;
      }
      try {
        const result =
          await configuration.bookingService.listProfessionalRequests(
            (response.locals.authUser as AuthUser).id,
            parsed.data,
          );
        if (result === "professional_ineligible") {
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
            bookingRequests: result.bookingRequests,
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

  router.get("/:requestId", async (request, response, next) => {
    const requestId = parseRequestId(request, response);
    if (!requestId) {
      return;
    }
    try {
      const result = await configuration.bookingService.findProfessionalRequest(
        (response.locals.authUser as AuthUser).id,
        requestId,
      );
      if (result === "professional_ineligible") {
        sendError(
          response,
          403,
          "PROFESSIONAL_NOT_ELIGIBLE",
          "An approved, active professional account is required",
        );
        return;
      }
      if (!result) {
        sendError(
          response,
          404,
          "BOOKING_REQUEST_NOT_FOUND",
          "Booking request was not found",
        );
        return;
      }
      response.json({ data: { bookingRequest: result } });
    } catch (error) {
      next(error);
    }
  });

  for (const decision of ["accept", "decline"] as const) {
    router.post(
      `/:requestId/${decision}`,
      routeRateLimit(configuration, `booking-request-${decision}`, 30),
      csrf,
      async (request, response, next) => {
        const requestId = parseRequestId(request, response);
        if (!requestId) {
          return;
        }
        if (!emptyActionInputSchema.safeParse(request.body).success) {
          sendError(response, 400, "INVALID_REQUEST", "Expected an empty body");
          return;
        }
        try {
          const result = await configuration.bookingService.decideRequest(
            (response.locals.authUser as AuthUser).id,
            requestId,
            decision === "accept" ? "accepted" : "declined",
          );
          if (result.type === "success") {
            response.json({ data: { bookingRequest: result.bookingRequest } });
            return;
          }
          if (result.type === "missing") {
            sendError(
              response,
              404,
              "BOOKING_REQUEST_NOT_FOUND",
              "Booking request was not found",
            );
            return;
          }
          if (result.type === "professional_ineligible") {
            sendError(
              response,
              403,
              "PROFESSIONAL_NOT_ELIGIBLE",
              "An approved, active professional account is required",
            );
            return;
          }
          sendError(
            response,
            409,
            "BOOKING_REQUEST_DECISION_CONFLICT",
            "This request has already received a different decision",
          );
        } catch (error) {
          if (handleConstraintError(error, response)) {
            return;
          }
          next(error);
        }
      },
    );
  }
  return router;
}

export function createNotificationRouter(
  configuration: BookingRouteConfiguration,
) {
  const router = Router();
  commonMiddleware(router, configuration);
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.get(
    "/",
    routeRateLimit(configuration, "notifications-list", 120),
    async (request, response, next) => {
      const parsed = notificationListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_REQUEST",
          "Invalid notification filters",
        );
        return;
      }
      try {
        const page = await configuration.bookingService.listNotifications(
          (response.locals.authUser as AuthUser).id,
          parsed.data,
        );
        response.json({
          data: {
            notifications: page.notifications,
            pagination: {
              page: parsed.data.page,
              pageSize: parsed.data.pageSize,
              total: page.total,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/:notificationId/read",
    routeRateLimit(configuration, "notification-read", 60),
    csrf,
    async (request, response, next) => {
      const parsedParams = notificationParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid notification ID");
        return;
      }
      if (!markNotificationReadInputSchema.safeParse(request.body).success) {
        sendError(response, 400, "INVALID_REQUEST", "Expected an empty body");
        return;
      }
      try {
        const notification =
          await configuration.bookingService.markNotificationRead(
            (response.locals.authUser as AuthUser).id,
            parsedParams.data.notificationId,
          );
        if (!notification) {
          sendError(
            response,
            404,
            "NOTIFICATION_NOT_FOUND",
            "Notification was not found",
          );
          return;
        }
        response.json({ data: { notification } });
      } catch (error) {
        if (handleConstraintError(error, response)) {
          return;
        }
        next(error);
      }
    },
  );
  return router;
}
