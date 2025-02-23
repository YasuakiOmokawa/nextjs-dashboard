import { z } from "zod";

export const credentialLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const emailLinkLoginSchema = z.object({
  email: z.string().email(),
});
