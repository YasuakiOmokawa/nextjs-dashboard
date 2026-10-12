// @cloudflare/workers-types を入れずに、使う型だけを書く
declare module "cloudflare:workers" {
  type DurableObjectContext =
    import("@/src/services/company-team-list").DurableObjectContext;

  export abstract class DurableObject {
    protected readonly ctx: DurableObjectContext;
    protected readonly env: unknown;
    constructor(ctx: DurableObjectContext, env: unknown);
  }
}
