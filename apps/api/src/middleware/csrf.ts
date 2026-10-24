import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "@evently/shared";
import { authSession } from "./sessions.js";

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidCsrfToken(
  expected: string | undefined,
  provided: string | undefined,
): boolean {
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function createCsrfMiddleware(appOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.get("origin");
    if (
      origin !== appOrigin ||
      !isValidCsrfToken(
        authSession(request).csrfToken,
        request.get("x-csrf-token"),
      )
    ) {
      const requestId = response.locals.requestId as string;
      const body: ApiErrorResponse = {
        error: {
          code: "CSRF_VALIDATION_FAILED",
          message: "Request could not be verified",
          requestId,
        },
      };
      response.status(403).json(body);
      return;
    }
    next();
  };
}
