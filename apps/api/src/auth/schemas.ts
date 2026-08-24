import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(200)
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200)
});

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
