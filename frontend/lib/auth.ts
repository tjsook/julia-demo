import { useSession } from "next-auth/react";

export function useCurrentUser() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";
  return { name, email };
}

export function getDashboardDisplayName(name: string, email: string): string {
  const trimmedName = name.trim();
  if (trimmedName) {
    return trimmedName;
  }

  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return "there";
  }

  const atSignIndex = trimmedEmail.indexOf("@");
  if (atSignIndex > 0) {
    return trimmedEmail.slice(0, atSignIndex);
  }
  return trimmedEmail;
}
