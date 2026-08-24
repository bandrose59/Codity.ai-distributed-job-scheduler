import argon2 from "argon2";
import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { ApiError } from "../common/errors.js";
import { createAccessToken } from "./middleware.js";
import { normalizeEmail } from "./schemas.js";

export async function registerUser(input: { name: string; email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: { name: input.name.trim(), email, passwordHash }
      });
      const organization = await transaction.organization.create({
        data: { name: `${createdUser.name}'s Organization` }
      });
      await transaction.organizationMember.create({
        data: {
          userId: createdUser.id,
          organizationId: organization.id,
          role: "OWNER"
        }
      });
      return createdUser;
    });

    return { user, token: createAccessToken(user.id) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
    }
    throw error;
  }
}

export async function loginUser(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
  const valid = user
    ? await argon2.verify(user.passwordHash, input.password).catch(() => false)
    : false;
  if (!valid || !user) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  return { user, token: createAccessToken(user.id) };
}
