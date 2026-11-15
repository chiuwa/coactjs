import type { RoomLimits, CoactUser, CoactRole } from './server-shared.js';
export interface WorkerEnvironment {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  COACT_ALLOWED_ROOMS?: string;
  [binding: string]: unknown;
}
export interface CoactWorkerOptions extends RoomLimits {
  mode?: 'demo' | 'production'; binding?: string; allowedRooms?: string[];
  rateLimit?: { messagesPerSecond?: number; burst?: number };
  origin?: (origin: string, request: Request, env: WorkerEnvironment) => boolean | Promise<boolean>;
  authenticate?: (request: Request, env: WorkerEnvironment) => CoactUser | null | Promise<CoactUser | null>;
  authorize?: (context: { user: CoactUser | null; room: string; action: string; message: Record<string, unknown>; role?: CoactRole; request?: Request }, env: WorkerEnvironment) => boolean | { allowed: boolean; role?: CoactRole } | Promise<boolean | { allowed: boolean; role?: CoactRole }>;
  onError?: (error: unknown) => void;
}
export const WORKER_LIMITS: Readonly<Required<RoomLimits> & { rateLimit: { messagesPerSecond: number; burst: number } }>;
export function createCoactWorker(options?: CoactWorkerOptions): { fetch(request: Request, env: WorkerEnvironment): Promise<Response> };
/** Export this class as the Durable Object named by your Wrangler binding. */
export function createCoactDurableObject(options?: CoactWorkerOptions): new (state: unknown, env: WorkerEnvironment) => {
  fetch(request: Request): Promise<Response>;
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(socket: WebSocket): Promise<void>;
  webSocketError(socket: WebSocket): Promise<void>;
  alarm(): Promise<void>;
};
