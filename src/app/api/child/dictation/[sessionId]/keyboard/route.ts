import { keyboardChildPost } from '@/modules/dictation/keyboard-http';
export async function POST(request:Request,context:RouteContext<'/api/child/dictation/[sessionId]/keyboard'>){return keyboardChildPost(request,(await context.params).sessionId)}
