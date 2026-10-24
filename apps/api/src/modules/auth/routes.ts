import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { rateLimit, type Store } from "express-rate-limit";
import type session from "express-session";
import type { ApiErrorResponse } from "@evently/shared";
import {
  accountEmailSchema,
  loginSchema,
  passwordResetSchema,
  registrationSchema,
  userIdParamsSchema,
  verificationSchema,
} from "./contracts.js";
import {
  EmailDeliveryUnavailableError,
  InvalidCredentialsError,
  type AuthService,
} from "./service.js";
import { toPublicUser } from "./repository.js";
import {
  createCsrfMiddleware,
  createCsrfToken,
} from "../../middleware/csrf.js";
import { authSession } from "../../middleware/sessions.js";

type RateLimitStoreFactory = (scope: string) => Store;

interface AuthRouteConfiguration {
  service: AuthService;
  appOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  rateLimitStoreFactory?: RateLimitStoreFactory;
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

function sessionOperation(
  sessionObject: session.Session,
  operation: "regenerate" | "save" | "destroy",
): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionObject[operation]((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function authRateLimit(
  configuration: AuthRouteConfiguration,
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
        "AUTH_RATE_LIMITED",
        "Too many attempts. Please try again later.",
      );
    },
  });
}

function handleEmailDeliveryError(error: unknown, response: Response): boolean {
  if (!(error instanceof EmailDeliveryUnavailableError)) {
    return false;
  }
  sendError(
    response,
    503,
    "EMAIL_DELIVERY_UNAVAILABLE",
    "Account email delivery is not configured",
  );
  return true;
}

const GENERIC_REGISTRATION_RESPONSE = {
  data: {
    message:
      "If this address can be registered, account instructions are available through the configured channel.",
  },
};
const GENERIC_EMAIL_RESPONSE = {
  data: {
    message:
      "If eligible, account instructions are available through the configured channel.",
  },
};

export function createAuthRouter(configuration: AuthRouteConfiguration) {
  const router = Router();
  const csrf = createCsrfMiddleware(configuration.appOrigin);

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    "/csrf",
    authRateLimit(configuration, "csrf", 60),
    async (request, response, next) => {
      try {
        const currentSession = authSession(request);
        currentSession.csrfToken ??= createCsrfToken();
        await sessionOperation(currentSession, "save");
        response.json({ data: { csrfToken: currentSession.csrfToken } });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/register",
    authRateLimit(configuration, "register", 5),
    csrf,
    async (request, response, next) => {
      const parsed = registrationSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_REGISTRATION",
          "Unable to register with these details",
        );
        return;
      }

      try {
        await configuration.service.register(parsed.data);
        response.status(202).json(GENERIC_REGISTRATION_RESPONSE);
      } catch (error) {
        if (handleEmailDeliveryError(error, response)) {
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    "/verification-request",
    authRateLimit(configuration, "verification-request", 5),
    csrf,
    async (request, response, next) => {
      const parsed = accountEmailSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }
      try {
        await configuration.service.requestVerification(parsed.data.email);
        response.status(202).json(GENERIC_EMAIL_RESPONSE);
      } catch (error) {
        if (handleEmailDeliveryError(error, response)) {
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    "/verify-email",
    authRateLimit(configuration, "verify-email", 10),
    csrf,
    async (request, response, next) => {
      const parsed = verificationSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }
      try {
        await configuration.service.verifyEmail(parsed.data.token);
        response.json({
          data: {
            message: "If the verification link was valid, it is complete.",
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/forgot-password",
    authRateLimit(configuration, "forgot-password", 5),
    csrf,
    async (request, response, next) => {
      const parsed = accountEmailSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }
      try {
        await configuration.service.requestPasswordReset(parsed.data.email);
        response.status(202).json(GENERIC_EMAIL_RESPONSE);
      } catch (error) {
        if (handleEmailDeliveryError(error, response)) {
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    "/reset-password",
    authRateLimit(configuration, "reset-password", 10),
    csrf,
    async (request, response, next) => {
      const parsed = passwordResetSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }
      try {
        await configuration.service.resetPassword(
          parsed.data.token,
          parsed.data.password,
        );
        response.json({
          data: {
            message: "If the reset link was valid, the password is updated.",
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/login",
    authRateLimit(configuration, "login", 10),
    csrf,
    async (request, response, next) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }

      try {
        const user = await configuration.service.authenticate(parsed.data);
        await sessionOperation(authSession(request), "regenerate");
        const currentSession = authSession(request);
        currentSession.userId = user.id;
        currentSession.csrfToken = createCsrfToken();
        await sessionOperation(currentSession, "save");
        response.json({
          data: {
            user: toPublicUser(user),
            csrfToken: currentSession.csrfToken,
          },
        });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          sendError(
            response,
            401,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          );
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    "/me",
    requireAuthentication(
      configuration.service,
      configuration.cookieName,
      configuration.secureCookies,
    ),
    (_request, response) => {
      response.json({
        data: {
          user: toPublicUser(response.locals.authUser),
        },
      });
    },
  );

  router.post(
    "/logout",
    requireAuthentication(
      configuration.service,
      configuration.cookieName,
      configuration.secureCookies,
    ),
    csrf,
    async (request, response, next) => {
      try {
        await sessionOperation(authSession(request), "destroy");
        response.clearCookie(configuration.cookieName, {
          httpOnly: true,
          secure: configuration.secureCookies,
          sameSite: "lax",
          path: "/",
        });
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export function createAdminRouter(configuration: AuthRouteConfiguration) {
  const router = Router();
  const requireAuth = requireAuthentication(
    configuration.service,
    configuration.cookieName,
    configuration.secureCookies,
  );

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/users/:userId/suspend",
    requireAuth,
    requireAdministrator,
    createCsrfMiddleware(configuration.appOrigin),
    async (request, response, next) => {
      const parsed = userIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        sendError(response, 400, "INVALID_REQUEST", "Invalid request");
        return;
      }
      try {
        const result = await configuration.service.suspendUser(
          response.locals.authUser.id,
          parsed.data.userId,
        );
        if (result === "missing") {
          sendError(response, 404, "USER_NOT_FOUND", "User was not found");
          return;
        }
        if (result === "self" || result === "already_inactive") {
          sendError(
            response,
            409,
            "ADMIN_ACTION_REJECTED",
            "The requested account action cannot be completed",
          );
          return;
        }
        response.json({ data: { status: "suspended" } });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

function requireAdministrator(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (response.locals.authUser.role !== "admin") {
    sendError(response, 403, "FORBIDDEN", "Administrator access is required");
    return;
  }
  next();
}

function requireAuthentication(
  service: AuthService,
  cookieName: string,
  secureCookies: boolean,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const currentSession = authSession(request);
    const userId = currentSession.userId;
    if (!userId) {
      sendError(response, 401, "UNAUTHENTICATED", "Authentication is required");
      return;
    }

    try {
      const user = await service.findActiveUser(userId);
      if (!user) {
        await sessionOperation(currentSession, "destroy");
        response.clearCookie(cookieName, {
          httpOnly: true,
          secure: secureCookies,
          sameSite: "lax",
          path: "/",
        });
        sendError(
          response,
          401,
          "UNAUTHENTICATED",
          "Authentication is required",
        );
        return;
      }
      response.locals.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function corsForOrigin(appOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.get("origin");
    if (origin && origin !== appOrigin) {
      sendError(
        response,
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed",
      );
      return;
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", appOrigin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.vary("Origin");
    }

    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-CSRF-Token",
      );
      response.status(204).end();
      return;
    }
    next();
  };
}
