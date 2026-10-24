import type { AuthUser } from "../modules/auth/repository.js";

declare global {
  namespace Express {
    interface Locals {
      authUser: AuthUser;
    }
  }
}
