export interface CoactUser { id: string; name?: string; [key: string]: unknown }
export type CoactRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export interface RoomLimits {
  requireDeliveryAck?: boolean; maxInFlightBytes?: number; maxInFlightMessages?: number;
  maxPayload?: number; maxDocumentBytes?: number; maxJournalBytes?: number;
  maxObjects?: number; maxTrackedPaths?: number; maxLocksPerClient?: number; maxPeers?: number;
  journalLimit?: number; receiptLimit?: number; maxPending?: number;
  lockTtlMs?: number; roomTtlMs?: number; cursorIntervalMs?: number;
  maxOutboundBytesPerSecond?: number; outboundBurstBytes?: number;
}
