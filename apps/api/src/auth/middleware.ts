import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

import { env } from "@job-scheduler/config";

import { ApiError } from "../common/errors.js";

export type AuthenticatedRequest = FastifyRequest & { userId: string };

export async function requireAuthentication(request: FastifyRequest, _reply: FastifyReply) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      throw new Error("Invalid subject");
    }
    (request as AuthenticatedRequest).userId = payload.sub;
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }
}

export function createAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as NonNullable<jwt.SignOptions["expiresIn"]>
  });
}
