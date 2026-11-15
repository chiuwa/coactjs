import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { CoactUser, CoactRole, RoomLimits } from './server-shared.js';
export type { CoactUser, CoactRole, RoomLimits } from './server-shared.js';
export interface AuthorizationContext {
  user: CoactUser | null; room: string; action: string; message: Record<string, unknown>;
  role?: CoactRole; request?: IncomingMessage;
}
export interface CoactServerOptions extends RoomLimits {
  maxPendingBytes?: number;
  mode?: 'demo' | 'production'; host?: string; port?: number; maxRooms?: number;
  maintenanceMs?: number; heartbeatMs?: number;
  origin?: (origin: string, request: IncomingMessage) => boolean | Promise<boolean>;
  authenticate?: (request: IncomingMessage, url: URL) => CoactUser | null | Promise<CoactUser | null>;
  authorize?: (context: AuthorizationContext) => boolean | { allowed: boolean; role?: CoactRole } | Promise<boolean | { allowed: boolean; role?: CoactRole }>;
  requestHandler?: (request: IncomingMessage, response: ServerResponse) => void;
  rateLimit?: { messagesPerSecond?: number; burst?: number; connectionsPerIp?: number; maxConnections?: number };
  journalSink?: (event: Record<string, unknown>) => void | Promise<void>;
  onError?: (error: unknown) => void;
}
export function createCoactServer(options?: CoactServerOptions): {
  readonly stats: { rooms: number; connections: number; pendingBytes: number; unacknowledgedBytes: number };
  server: Server; start(): Promise<{ port: number }>; stop(): Promise<void>;
};
