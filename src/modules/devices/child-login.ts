import type { AuthorizedChild } from './service';
export async function loadChildLogin(
  token: string | undefined,
  list: (token: string) => Promise<AuthorizedChild[]>,
): Promise<{ state: 'paired' | 'unpaired'; children: AuthorizedChild[] }> {
  if (!token) return { state: 'unpaired', children: [] };
  try { return { state: 'paired', children: await list(token) }; }
  catch (error) {
    if (error instanceof Error && error.message === 'DEVICE_INVALID') return { state: 'unpaired', children: [] };
    throw error;
  }
}
