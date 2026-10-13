// biome-ignore lint/style/noRestrictedImports: registry を router の context と React に渡す
import { RegistryContext } from "@effect/atom-react";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
// biome-ignore lint/style/noRestrictedImports: registry を router の context と React に渡す
import { AtomRegistry } from "effect/reactivity";
import { loadAtom, meAtom, membersAtom, teamAtom, teamsAtom } from "@/api";
import DashboardLayout, { DashboardError } from "@/dashboard/dashboard-layout";
import MembersPage, { MembersError } from "@/dashboard/members-page";
import TeamPage, { TeamError } from "@/dashboard/team-page";
import TeamsPage, { TeamsError } from "@/dashboard/teams-page";
import LandingPage from "@/landing/landing-page";
import PrivacyPage from "@/privacy/privacy-page";

const rootRoute = createRootRouteWithContext<{
  registry: AtomRegistry.AtomRegistry;
}>()();

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  loader: ({ context }) => loadAtom(context.registry, meAtom),
  component: DashboardLayout,
  errorComponent: DashboardError,
});

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: LandingPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: PrivacyPage,
  }),
  dashboardRoute.addChildren([
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/",
      beforeLoad: () => {
        throw redirect({ to: "/dashboard/teams" });
      },
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/teams",
      loader: ({ context }) => loadAtom(context.registry, teamsAtom),
      component: TeamsPage,
      errorComponent: TeamsError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/teams/$teamId",
      loader: ({ context, params }) =>
        loadAtom(context.registry, teamAtom(params.teamId)),
      component: TeamPage,
      errorComponent: TeamError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/members",
      loader: ({ context }) => loadAtom(context.registry, membersAtom),
      component: MembersPage,
      errorComponent: MembersError,
    }),
  ]),
]);

export const createAppRouter = (
  options: { history?: RouterHistory; origin?: string } = {},
) => {
  const registry = AtomRegistry.make();
  return createRouter({
    routeTree,
    context: { registry },
    defaultPreload: "intent",
    // 既定の background は前に描いた match を loader を待たずに出し、invalidate した一覧も出してしまう
    defaultStaleReloadMode: "blocking",
    Wrap: ({ children }) => (
      <RegistryContext.Provider value={registry}>
        {children}
      </RegistryContext.Provider>
    ),
    ...options,
  });
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
