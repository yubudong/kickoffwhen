import type { createEngagementService } from './service';
export type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? {
    [K in keyof T]: Json<T[K]>;
} : T;
export type EngagementView = Json<Awaited<ReturnType<ReturnType<typeof createEngagementService>['list']>>>;
