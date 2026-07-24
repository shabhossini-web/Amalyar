const API_PREFIX = '/api';

/**
 * Coolify path routing can remove the public /api prefix before proxying the
 * request to the container. Nest still owns routes below the global "api"
 * prefix, so restore it when it is absent.
 *
 * Keeping this at the application boundary preserves the public same-origin
 * /api contract for every tenant without accepting a tenant selector from
 * headers or request bodies.
 */
export function restoreApiPrefix(url: string): string {
  const value = url || '/';

  if (
    value === API_PREFIX ||
    value.startsWith(`${API_PREFIX}/`) ||
    value.startsWith(`${API_PREFIX}?`)
  ) {
    return value;
  }

  return `${API_PREFIX}${value.startsWith('/') ? value : `/${value}`}`;
}
