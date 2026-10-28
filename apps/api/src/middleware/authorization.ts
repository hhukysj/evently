import type { NextFunction, Request, Response } from "express";
import type { AuthService } from "../modules/auth/service.js";
import { authSession } from "./sessions.js";

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: {
      code,
      message,
      requestId: response.locals.requestId as string,
    },
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    authSession(request).destroy((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function requireAuthentication(
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
      if (!user || (currentSession.authVersion ?? 0) !== user.authVersion) {
        await destroySession(request);
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

export function requireRole(role: "admin" | "professional" | "customer") {
  return (_request: Request, response: Response, next: NextFunction) => {
    if (response.locals.authUser.role !== role) {
      sendError(
        response,
        403,
        "FORBIDDEN",
        role === "admin"
          ? "Administrator access is required"
          : role === "professional"
            ? "Professional access is required"
            : "Customer access is required",
      );
      return;
    }
    next();
  };
}
