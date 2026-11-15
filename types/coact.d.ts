export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export interface CoactPoint { x?: number; y?: number; down?: boolean }
export interface Geometry { x: number; y: number; w: number; h: number }
export interface Actor { id: string; userId?: string | null; name: string; badge?: string; color: string; role?: Role }
export interface Peer extends Actor { x: number; y: number; down: boolean }
export interface WindowState extends Geometry { id: string; z: number; actor?: Actor }
export interface FrameState extends WindowState { prompt: string; status: 'empty' | 'generating' | 'generated'; seed: number }
export interface Selection { clientId: string; address: string | null; name?: string; color?: string; badge?: string }
export interface SheetState { cells: Record<string, string>; selections: Record<string, Selection> }
/** Public lease metadata. The ownership token stays private to the client. */
export interface Lock { path: string; actorId: string; name: string; color: string; badge?: string; expiresAt: number }
export interface JournalEvent { id: string; seq: number; at: string; room: string; revision: number; actor: Actor; type: string; path?: string; requestId?: string; before?: unknown; after?: unknown }
export interface CoactOptions {
  room?: string; endpoint?: string; name?: string; safeBottom?: number; maxPayload?: number; maxPendingBytes?: number; maxIncomingBytes?: number;
  'placeholder-image'?: string; 'placeholder-title'?: string;
  'placeholder-code'?: string; 'placeholder-note'?: string;
}
export interface WindowOptions {
  title?: string; accent?: string; open?: boolean;
  start?: Pick<Geometry, 'x' | 'y'>; size?: Pick<Geometry, 'w' | 'h'>;
  /** Trusted application content; never pass untrusted HTML. Its contents do not sync automatically. */
  content?: string | Node | (() => Node);
}
export type StateMutation =
  | { type: 'sheet'; action: 'cell'; address: string; value: string }
  | { type: 'sheet'; action: 'replace'; cells: Record<string, string> }
  | { type: 'window'; action: 'open' | 'close' | 'move' | 'resize'; id: string; state?: Partial<Geometry>; final?: boolean }
  | { type: 'frame'; action: 'create' | 'delete' | 'move' | 'resize' | 'generate'; id: string; state?: Partial<Geometry>; final?: boolean }
  | { type: 'frame'; action: 'update'; id: string; prompt: string }
  | { type: 'reset' };
export interface Ack { replayed?: boolean; type: 'ack'; accepted: true; requestId: string; revision: number; path: string; update: Record<string, unknown> }
export interface Conflict { type: 'conflict'; accepted: false; requestId: string; revision: number; path: string; reason: string; current: { windows: Record<string, WindowState>; frames: Record<string, FrameState>; sheet: SheetState; locks: Record<string, Lock>; revision: number } }
export interface CoactEventMap {
  'coact:presence': { self: Peer; peers: Peer[]; online: number };
  'coact:status': { state: 'connecting' | 'online' | 'offline'; online: number; error?: string };
  'coact:windows': { action: string; windows: Record<string, WindowState>; changed: unknown };
  'coact:frames': { action: string; frames: Record<string, FrameState>; changed: unknown };
  'coact:sheet': { action: string; sheet: SheetState; changed: unknown };
  'coact:ready': { windows: Record<string, WindowState>; frames: Record<string, FrameState>; sheet: SheetState };
  'coact:journal': { action: string; events: JournalEvent[]; journal: JournalEvent[]; revision: number; truncated?: boolean; fromSeq?: number; nextSeq?: number };
  'coact:action': { name: string; payload: Record<string, unknown>; actor: Actor };
  'coact:drawmode': { active: boolean; type: 'image-frame' };
  'coact:ack': Ack;
  'coact:conflict': Conflict;
  'coact:error': { code: string; requestId?: string };
  'coact:unsaved': { code: string; operations: (StateMutation & { requestId?: string; baseRevision?: number })[] };
  'coact:lock': { type: string; path?: string; paths?: string[]; lock?: Lock; reason?: string };
}
export interface CollectionAdapter<T> {
  event: string;
  snapshot(room: CoactRoom): Record<string, T>;
  get?(room: CoactRoom, key: string): T | undefined;
  set(room: CoactRoom, key: string, value: T): boolean | void;
  replace(room: CoactRoom, values: Record<string, T>): boolean | void;
  select?(room: CoactRoom, key: string): void;
}
export interface CoactCollection<T = string> {
  readonly name: string; readonly snapshot: Record<string, T>;
  get(key: string): T | undefined; set(key: string, value: T): boolean | void;
  replace(values: Record<string, T>): boolean | void; select(key: string): void;
  subscribe(handler: (snapshot: Record<string, T>, detail: unknown) => void): () => void;
}
export type MutationPayload<T extends StateMutation['type']> = StateMutation extends infer M ? M extends { type: T } ? Omit<M, 'type'> & { baseRevision?: number } : never : never;
export class CoactRoom extends HTMLElement {
  readonly room: string; readonly self: Peer; readonly peers: Peer[]; readonly online: number;
  readonly windows: Record<string, WindowState>; readonly frames: Record<string, FrameState>;
  readonly sheet: SheetState; readonly stats: CoactStats; readonly revision: number; readonly journal: JournalEvent[]; readonly locks: Record<string, Lock>;
  registerWindow(id: string, options?: WindowOptions): this;
  defineWindow(id: string, options?: WindowOptions): this;
  openWindow(id: string, overrides?: Partial<Geometry>): HTMLElement | null | false;
  closeWindow(id: string): void | false; focusWindow(id: string): void | false;
  addImageFrame(rect?: Geometry | null): string | false; deleteFrame(id: string): void | false;
  startFrameDraw(): void | false; cancelFrameDraw(): void;
  updateSheetCell(address: string, value: string): boolean;
  replaceSheet(cells: Record<string, string>): boolean; selectSheetCell(address: string): void;
  collection<T = string>(name: string): CoactCollection<T>;
  registerCollection<T>(name: string, adapter: CollectionAdapter<T>): CoactCollection<T>;
  action(name: string, payload?: Record<string, unknown>): boolean;
  publishCursor(point?: CoactPoint): boolean;
  request<T extends StateMutation['type']>(type: T, ...args: T extends 'reset' ? [payload?: MutationPayload<T>] : [payload: MutationPayload<T>]): Promise<Ack>;
  journalSince(seq?: number): boolean;
  acquireLock(path: string, ttlMs?: number): boolean; renewLock(path: string): boolean; releaseLock(path: string): boolean;
  connect(): void; disconnect(): void; resetRoom(): boolean; reconcileState(): void;
}
export class CoactCanvas extends CoactRoom {}
export const CoactRoomElement: typeof CoactRoom;
export interface CoactStats { pendingMutations: number; pendingBytes: number; peers: number; windows: number; frames: number; cells: number; journalEntries: number }
export interface CoactApi {
  readonly element: CoactRoom;
  readonly self: Peer; readonly peers: Peer[]; readonly online: number;
  readonly windows: Record<string, WindowState>; readonly frames: Record<string, FrameState>;
  readonly stats: CoactStats; readonly revision: number; readonly journal: JournalEvent[]; readonly locks: Record<string, Lock>;
  cursor: { publish(point?: CoactPoint): boolean };
  presence: { subscribe(handler: (detail: CoactEventMap['coact:presence']) => void): () => void };
  objects: {
    readonly snapshot: Record<string, WindowState | FrameState>;
    /** Explicit object kind; keeps the caller's id. Window content must be registered first. */
    set(id: string, value: Partial<Geometry> & { kind: 'window' | 'frame' }): Promise<Ack>;
    delete(id: string): void | false;
    subscribe(handler: (snapshot: Record<string, WindowState | FrameState>, detail: unknown) => void): () => void;
  };
  collection<T = string>(name: string): CoactCollection<T>;
  registerCollection<T>(name: string, adapter: CollectionAdapter<T>): CoactCollection<T>;
  action(name: string, payload?: Record<string, unknown>): boolean;
  request<T extends StateMutation['type']>(type: T, ...args: T extends 'reset' ? [payload?: MutationPayload<T>] : [payload: MutationPayload<T>]): Promise<Ack>;
  journalSince(seq?: number): boolean;
  lock: { acquire(path: string, ttlMs?: number): boolean; renew(path: string): boolean; release(path: string): boolean };
  on<K extends keyof CoactEventMap>(type: K, handler: (event: CustomEvent<CoactEventMap[K]>) => void): () => void;
  on(type: string, handler: EventListenerOrEventListenerObject): () => void;
  connect(): void; disconnect(): void; reset(): boolean;
}
export function createCoact(target: string | CoactRoom, options?: CoactOptions): CoactApi;
export const sheetCollection: CollectionAdapter<string>;
export const Coact: {
  attach: typeof createCoact; create: typeof createCoact;
  adapters: { readonly sheet: typeof sheetCollection };
  /** @deprecated Use Coact.adapters.sheet. */
  collection: { readonly sheet: typeof sheetCollection };
};
export default Coact;
declare global { interface HTMLElementTagNameMap { 'coact-room': CoactRoom; 'coact-canvas': CoactCanvas } }
