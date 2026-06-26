import NextAuth, { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";

type GoogleTokenRefresh = {
  id_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function refreshGoogleIdToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) {
    return { ...token, idToken: undefined, authError: "Google refresh token is missing." };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
  });
  const refreshed = (await response.json()) as GoogleTokenRefresh;
  if (!response.ok || !refreshed.id_token || !refreshed.expires_in) {
    const detail = refreshed.error_description ?? refreshed.error ?? "Google token refresh failed.";
    return { ...token, idToken: undefined, authError: detail };
  }

  return {
    ...token,
    idToken: refreshed.id_token,
    idTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
    refreshToken: refreshed.refresh_token ?? token.refreshToken,
    authError: undefined,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },
  callbacks: {
    async signIn({ user, profile }) {
      const email = profile?.email ?? user?.email ?? "";
      if (!email.endsWith("@hemut.com")) return false;
      const allowedEmails = (process.env.NEXTAUTH_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      if (allowedEmails.length === 0) return false;
      return allowedEmails.includes(email);
    },
    async jwt({ token, account }) {
      if (account?.id_token) {
        token.idToken = account.id_token;
        token.idTokenExpiresAt = account.expires_at ? account.expires_at * 1000 : Date.now() + 55 * 60 * 1000;
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        token.authError = undefined;
        return token;
      }
      if (token.idToken && token.idTokenExpiresAt && Date.now() < token.idTokenExpiresAt - 60_000) {
        return token;
      }
      if (token.idTokenExpiresAt) return refreshGoogleIdToken(token);
      return token;
    },
    async session({ session, token }) {
      if (typeof token.idToken === "string") {
        session.idToken = token.idToken;
      }
      if (typeof token.authError === "string") {
        session.authError = token.authError;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
};

export default NextAuth(authOptions);
