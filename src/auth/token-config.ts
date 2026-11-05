const ACCESS_TTL_PATTERN = /^(?:[1-9]\d*)(?:s|m|h|d)$/;
const MAX_ACCESS_TTL_SECONDS = 24 * 60 * 60;
const MAX_REFRESH_TTL_SECONDS = 365 * 24 * 60 * 60;

export function validateEnvironment(env: Record<string, unknown>) {
  const accessTtl = env.JWT_ACCESS_TOKEN_TTL ?? '1d';
  if (typeof accessTtl !== 'string' || !ACCESS_TTL_PATTERN.test(accessTtl)) {
    throw new Error(
      'JWT_ACCESS_TOKEN_TTL must be a positive duration such as 15m, up to 24 hours',
    );
  }
  const accessSeconds =
    Number(accessTtl.slice(0, -1)) *
    ({ s: 1, m: 60, h: 3600, d: 86400 }[accessTtl.slice(-1)] ?? 0);
  if (
    !Number.isSafeInteger(accessSeconds) ||
    accessSeconds > MAX_ACCESS_TTL_SECONDS
  ) {
    throw new Error(
      'JWT_ACCESS_TOKEN_TTL must be a positive duration up to 24 hours',
    );
  }

  const refreshTtl = env.JWT_REFRESH_TOKEN_TTL_SECONDS ?? '604800';
  const refreshSeconds =
    typeof refreshTtl === 'number' ? refreshTtl : Number(refreshTtl);
  if (
    !Number.isSafeInteger(refreshSeconds) ||
    refreshSeconds <= 0 ||
    refreshSeconds > MAX_REFRESH_TTL_SECONDS
  ) {
    throw new Error(
      'JWT_REFRESH_TOKEN_TTL_SECONDS must be a positive integer no greater than one year',
    );
  }

  return {
    ...env,
    JWT_ACCESS_TOKEN_TTL: accessTtl,
    JWT_REFRESH_TOKEN_TTL_SECONDS: refreshSeconds,
  };
}
