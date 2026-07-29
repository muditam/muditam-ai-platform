import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    service: z.literal("metabolic-assistant"),
    status: z.enum(["ready", "disabled"]),
    version: z.string().min(1),
    timestamp: z.string().datetime(),
  }),
  error: z.null(),
  requestId: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
