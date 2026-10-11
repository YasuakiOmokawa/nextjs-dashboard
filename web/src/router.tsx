import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { loadQuery, membersQuery, meQuery, teamQuery, teamsQuery } from "@/api";
import DashboardLayout, { DashboardError } from "@/dashboard/dashboard-layout";
import MembersPage, { MembersError } from "@/dashboard/members-page";
import TeamPage, { TeamError } from "@/dashboard/team-page";
import TeamsPage, { TeamsError } from "@/dashboard/teams-page";
import LandingPage from "@/landing/landing-page";
import PrivacyPage from "@/privacy/privacy-page";

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()();

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  loader: ({ context }) => loadQuery(context.queryClient, meQuery),
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
      loader: ({ context }) => loadQuery(context.queryClient, teamsQuery),
      component: TeamsPage,
      errorComponent: TeamsError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/teams/$teamId",
      loader: ({ context, params }) =>
        loadQuery(context.queryClient, teamQuery(params.teamId)),
      component: TeamPage,
      errorComponent: TeamError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/members",
      loader: ({ context }) => loadQuery(context.queryClient, membersQuery),
      component: MembersPage,
      errorComponent: MembersError,
    }),
  ]),
]);

export const createAppRouter = (
  options: { history?: RouterHistory; origin?: string } = {},
) => {
  const queryClient = new QueryClient({
    // 取り直すかは loader (loadQuery) が決め、描いた component は同じ query を取り直さない
    defaultOptions: { queries: { refetchOnMount: false } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // 既定の background は前に描いた match を loader を待たずに出し、invalidate した一覧も出してしまう
    defaultStaleReloadMode: "blocking",
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
