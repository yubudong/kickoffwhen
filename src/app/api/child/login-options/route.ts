import { loadChildLogin } from '@/modules/devices/child-login';
import { listAuthorizedChildren } from '@/modules/devices/service';
import { DEVICE_TOKEN_COOKIE, readCookie } from '@/modules/devices/token';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  try {
    const result = await loadChildLogin(readCookie(request, DEVICE_TOKEN_COOKIE) ?? undefined, listAuthorizedChildren);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: '暂时无法读取孩子列表，请稍后重试。' }, { status: 503, headers });
  }
}
