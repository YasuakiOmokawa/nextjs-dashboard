import type { DurableObjectContext } from "@/src/services/company-team-list";

// node の vitest には cloudflare:workers が無いので、vitest.config.ts の alias でこれに替える
export class DurableObject {
  constructor(
    protected readonly ctx: DurableObjectContext,
    protected readonly env: unknown,
  ) {}
}
