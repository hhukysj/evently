import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import type { ApiErrorResponse, HealthResponse } from "@evently/shared";
import type session from "express-session";
import type { Store } from "express-rate-limit";
import { createSessionMiddleware } from "./middleware/sessions.js";
import {
  createAdminRouter,
  createAuthRouter,
  corsForOrigin,
} from "./modules/auth/routes.js";
import type { DevelopmentEmailInbox } from "./modules/auth/email-delivery.js";
import type { AuthService } from "./modules/auth/service.js";
import {
  createAdminProviderApplicationRouter,
  createProfessionalRouter,
  createProviderApplicationRouter,
} from "./modules/providers/routes.js";
import type { ProviderService } from "./modules/providers/service.js";

export interface DatabaseProbe {
  query: (query: "SELECT 1") => Promise<unknown>;
}

export interface AuthAppConfiguration {
  service: AuthService;
  providerService?: ProviderService;
  environment: "development" | "test" | "production";
  developmentEmailInbox?: DevelopmentEmailInbox;
  sessionStore: session.Store;
  sessionSecret: string;
  appOrigin: string;
  secureCookies: boolean;
  cookieName: string;
  trustProxyHops: number;
  rateLimitStoreFactory?: (scope: string) => Store;
}

function requestId(response: Response): string {
  return response.locals.requestId as string;
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
      requestId: requestId(response),
    },
  });
}

export function createApp(
  database: DatabaseProbe,
  authConfiguration?: AuthAppConfiguration,
) {
  const app = express();

  app.disable("x-powered-by");
  if (authConfiguration && authConfiguration.trustProxyHops > 0) {
    app.set("trust proxy", authConfiguration.trustProxyHops);
  }
  app.use((_request: Request, response: Response, next) => {
    response.locals.requestId = randomUUID();
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use(
    express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 100 }),
  );

  app.get("/health", (_request, response: Response<HealthResponse>) => {
    response.json({
      data: {
        status: "ok",
        service: "evently-api",
      },
    });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await database.query("SELECT 1");
      response.json({
        data: {
          status: "ok",
          service: "evently-api",
        },
      });
    } catch (error) {
      console.error("API readiness database check failed", {
        requestId: requestId(response),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      sendError(response, 503, "SERVICE_UNAVAILABLE", "Service is not ready");
    }
  });

  const apiV1 = express.Router();
  apiV1.get("/health", (_request, response: Response<HealthResponse>) => {
    response.json({
      data: {
        status: "ok",
        service: "evently-api",
      },
    });
  });

  if (authConfiguration) {
    const authApi = express.Router();
    authApi.use(corsForOrigin(authConfiguration.appOrigin));
    authApi.use(
      createSessionMiddleware({
        secret: authConfiguration.sessionSecret,
        secureCookies: authConfiguration.secureCookies,
        store: authConfiguration.sessionStore,
      }),
    );
    authApi.use(
      "/auth",
      createAuthRouter({
        service: authConfiguration.service,
        appOrigin: authConfiguration.appOrigin,
        cookieName: authConfiguration.cookieName,
        secureCookies: authConfiguration.secureCookies,
        rateLimitStoreFactory: authConfiguration.rateLimitStoreFactory,
      }),
    );
    authApi.use(
      "/admin",
      createAdminRouter({
        service: authConfiguration.service,
        appOrigin: authConfiguration.appOrigin,
        cookieName: authConfiguration.cookieName,
        secureCookies: authConfiguration.secureCookies,
        rateLimitStoreFactory: authConfiguration.rateLimitStoreFactory,
      }),
    );
    if (authConfiguration.providerService) {
      const providerRouteConfiguration = {
        authService: authConfiguration.service,
        providerService: authConfiguration.providerService,
        appOrigin: authConfiguration.appOrigin,
        cookieName: authConfiguration.cookieName,
        secureCookies: authConfiguration.secureCookies,
        rateLimitStoreFactory: authConfiguration.rateLimitStoreFactory,
      };
      authApi.use(
        "/provider-applications",
        createProviderApplicationRouter(providerRouteConfiguration),
      );
      authApi.use(
        "/admin/provider-applications",
        createAdminProviderApplicationRouter(providerRouteConfiguration),
      );
      authApi.use(
        "/professional",
        createProfessionalRouter(providerRouteConfiguration),
      );
    }
    if (
      authConfiguration.environment === "development" &&
      authConfiguration.developmentEmailInbox
    ) {
      const developmentEmailInbox = authConfiguration.developmentEmailInbox;
      authApi.get("/dev/email-inbox", (_request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.json({
          data: { messages: developmentEmailInbox.listMessages() },
        });
      });
    }
    apiV1.use(authApi);
  }

  app.use("/api/v1", apiV1);

  app.use("/api/v1", (_request, response) => {
    sendError(response, 404, "NOT_FOUND", "API route not found");
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const id = requestId(response);
    console.error("Unhandled API error", {
      requestId: id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 400 || error.status === 413 || error.status === 415)
        ? error.status
        : 500;
    sendError(
      response,
      status,
      status === 400
        ? "BAD_REQUEST"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : status === 415
            ? "UNSUPPORTED_MEDIA_TYPE"
            : "INTERNAL_SERVER_ERROR",
      status === 400
        ? "Request body is invalid"
        : status === 413
          ? "Request body is too large"
          : status === 415
            ? "Request body encoding is not supported"
            : "An unexpected error occurred",
    );
  };
  app.use(errorHandler);

  return app;
}
