import { Session } from "next-auth";

type Authorize = {
  isLoggedIn: boolean;
  isAuthjsRequest: boolean;
  isApplicationRequest: boolean;
};

export const isLoggedIn = (auth: Session): boolean => {
  return !!auth.user;
};

type AuthJsRequest = {
  pathname: "/api/auth/verify-request";
  param: "token";
};

type ApplicationRequest = {
  pathname: "/";
};

type NotLoggedInRequest = {
  authjs: AuthJsRequest;
  application: ApplicationRequest;
};
