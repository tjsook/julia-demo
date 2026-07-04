// Standalone-demo stub. The original diesel-dashboard version reads a
// Google ID token from the NextAuth session and sends it as a Bearer token;
// julia-demo's backend `main.py` overrides `require_dashboard_user` with a
// demo stub that ignores the header, so we return empty headers here.
export async function getDashboardAuthHeaders(): Promise<HeadersInit> {
  return {};
}
