import type { CompanyId } from "@/db/ids";
import type { AuthorizationContext } from "./authorization-context";
import type { CompanyContext } from "./company-context";
import type { CompanyMembers } from "./company-members-service";
import type { CompanyTeamList } from "./company-team-list";

export type RequestSession = CompanyContext["Service"] &
  AuthorizationContext["Service"] & {
    readonly userName: string;
    readonly companyMembers: CompanyMembers["Service"];
    readonly companyTeamListOf: (
      companyId: CompanyId,
    ) => CompanyTeamList["Service"];
  };
