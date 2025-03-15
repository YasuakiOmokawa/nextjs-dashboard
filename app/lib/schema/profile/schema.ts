import { z } from "zod";

export const userSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

export const deleteUserSchema = z.object({
  id: z.string(),
});
