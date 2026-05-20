import { useSession } from "next-auth/react";

export function useCurrentUser() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "";
  const email = session?.user?.email ?? "";
  return { name, email };
}
