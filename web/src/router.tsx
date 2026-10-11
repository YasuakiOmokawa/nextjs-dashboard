import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { membersQuery, meQuery, teamQuery, teamsQuery } from "@/api";
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
  loader: ({ context }) => context.queryClient.fetchQuery(meQuery),
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
      loader: ({ context }) => context.queryClient.fetchQuery(teamsQuery),
      component: TeamsPage,
      errorComponent: TeamsError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/teams/$teamId",
      loader: ({ context, params }) =>
        context.queryClient.fetchQuery(teamQuery(params.teamId)),
      component: TeamPage,
      errorComponent: TeamError,
    }),
    createRoute({
      getParentRoute: () => dashboardRoute,
      path: "/members",
      loader: ({ context }) => context.queryClient.fetchQuery(membersQuery),
      component: MembersPage,
      errorComponent: MembersError,
    }),
  ]),
]);

export const createAppRouter = (
  options: { history?: RouterHistory; origin?: string } = {},
) => {
  const queryClient = new QueryClient({
    // 画面の移動ごとに loader が取り直す (事業所を切り替えた後に前の事業所の cache を出さない)。描いた component は同じ query を取り直さない
    defaultOptions: { queries: { refetchOnMount: false } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
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
