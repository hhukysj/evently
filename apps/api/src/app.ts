import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import type { ApiErrorResponse, HealthResponse } from "@evently/shared";

export interface DatabaseProbe {
  query: (query: "SELECT 1") => Promise<unknown>;
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

export function createApp(database: DatabaseProbe) {
  const app = express();

  app.disable("x-powered-by");
  app.use((_request: Request, response: Response, next) => {
    response.locals.requestId = randomUUID();
    next();
  });
  app.use(express.json({ limit: "32kb" }));

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
      (error.status === 400 || error.status === 413)
        ? error.status
        : 500;
    sendError(
      response,
      status,
      status === 400
        ? "BAD_REQUEST"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : "INTERNAL_SERVER_ERROR",
      status === 400
        ? "Request body is invalid"
        : status === 413
          ? "Request body is too large"
          : "An unexpected error occurred",
    );
  };
  app.use(errorHandler);

  return app;
}
