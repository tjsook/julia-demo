import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    idToken?: string;
    authError?: string;
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    idToken?: string;
    idTokenExpiresAt?: number;
    refreshToken?: string;
    authError?: string;
  }
}
