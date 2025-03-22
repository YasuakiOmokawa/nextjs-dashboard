import { z } from "zod";

export const emailLinkLoginSchema = z.object({
  email: z.string().email(),
});
