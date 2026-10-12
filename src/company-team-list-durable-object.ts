import { DurableObject } from "cloudflare:workers";
import {
  type TeamListSnapshot,
  TeamListStore,
  type TeamListStub,
} from "@/src/services/company-team-list";

export class CompanyTeamListDurableObject
  extends DurableObject
  implements TeamListStub
{
  readonly #store = new TeamListStore(this.ctx.storage.sql);

  read(workerVersion: string) {
    return this.#store.read(workerVersion);
  }

  replace(workerVersion: string, snapshot: TeamListSnapshot) {
    this.#store.replace(workerVersion, snapshot);
  }

  clear() {
    this.#store.clear();
  }
}
