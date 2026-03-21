/**
 * streaming/index.ts — Barrel exports for the streaming module (M4 Task 4.5)
 */

export { EventStream } from './event-stream';
export type { StreamFilter, StreamClient, StreamEvent, EventStreamOptions } from './event-stream';
export { SseTransport } from './sse-transport';
export type { SseTransportOptions } from './sse-transport';
export { WsTransport } from './ws-transport';
export type { WsTransportOptions } from './ws-transport';
