import type { AppProps } from "next/app";
import "../styles/globals.css";
import { installFetchCache } from "../lib/session-cache";

installFetchCache();

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
