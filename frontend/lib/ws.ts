import { wsUrl } from "@/lib/api";
import type { WsClientMessage, WsServerMessage } from "@/types/api";

type MessageHandler = (msg: WsServerMessage) => void;
type StatusHandler = (status: "connecting" | "open" | "closed" | "error") => void;

/**
 * Small reconnect-safe WebSocket client for the interview loop
 * (`WS /api/interviews/{id}/ws`). Auto-reconnects with backoff unless
 * explicitly closed, and queues outgoing messages sent while disconnected.
 */
export class InterviewSocket {
  private socket: WebSocket | null = null;
  private readonly path: string;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private closedByClient = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: WsClientMessage[] = [];

  constructor(interviewId: string) {
    this.path = `/api/interviews/${interviewId}/ws`;
  }

  connect(): void {
    this.closedByClient = false;
    this.open();
  }

  private open(): void {
    this.emitStatus("connecting");
    const socket = new WebSocket(wsUrl(this.path));
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.emitStatus("open");
      while (this.queue.length > 0) {
        const msg = this.queue.shift();
        if (msg) this.socket?.send(JSON.stringify(msg));
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsServerMessage;
        this.messageHandlers.forEach((h) => h(data));
      } catch {
        // ignore malformed frame
      }
    };

    socket.onerror = () => {
      this.emitStatus("error");
    };

    socket.onclose = () => {
      this.emitStatus("closed");
      if (!this.closedByClient) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 10000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByClient) this.open();
    }, delay);
  }

  send(msg: WsClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private emitStatus(status: "connecting" | "open" | "closed" | "error") {
    this.statusHandlers.forEach((h) => h(status));
  }

  close(): void {
    this.closedByClient = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }
}
