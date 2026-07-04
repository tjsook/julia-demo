// Fill-in-the-blank brand identity for the Julia demo frontend.
//
// Any string a customer would want to change lives here. All fields are
// optional at runtime; the UI degrades gracefully when a value is empty.
//
// To white-label the demo, either edit this file directly or set the
// corresponding NEXT_PUBLIC_* env vars (which take precedence when present).

export const BRAND = {
  // Company name shown in report headers, tab titles, and screen-reader text.
  // Example: "Acme Freight"
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "",

  // Path (relative to /public) or absolute URL of a logo shown in the ROI
  // report header. Empty string = no logo rendered.
  // Example: "/acme-logo.png"
  logoUrl: process.env.NEXT_PUBLIC_BRAND_LOGO_URL ?? "",

  // Product name shown in the browser tab title.
  productName: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Julia Demo",
} as const;
