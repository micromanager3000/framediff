export function isIgnorableBrowserResponse({ status, url, harnessOrigin }) {
  if (status !== 404) return false;
  const parsed = new URL(url);
  if (parsed.pathname === "/favicon.ico") return true;
  if (parsed.hostname.endsWith("huggingface.co") || parsed.pathname.startsWith("/models/")) {
    return true;
  }
  return parsed.origin === harnessOrigin && /^\/%23[^/]+$/.test(parsed.pathname);
}
