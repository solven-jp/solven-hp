export function validateBrowserE2ETarget(rawUrl, environment = {}) {
  const target = new URL(rawUrl);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(target.hostname);
  if (loopback) return target.origin;

  const allowlist = String(environment.SOLVEN_E2E_ALLOWED_REMOTE_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    target.protocol !== "https:"
    || environment.SOLVEN_E2E_ALLOW_REMOTE !== "true"
    || !allowlist.includes(target.origin)
  ) {
    throw new Error("remote_e2e_target_requires_https_explicit_approval_and_exact_origin_allowlist");
  }
  return target.origin;
}
