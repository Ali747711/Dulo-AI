// src/session/store.ts
// The only way session data reaches disk (or, later, Postgres). Session logic
// depends on this interface and nothing else; the file implementation is the
// default and a database implementation may be added behind DULO_DATABASE_URL.
import type {
  ChatMessage,
  Session,
  SessionEvent,
  SessionSummary,
  Turn,
  TurnSettings,
} from "./types.js";

export interface StoredFile {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

export interface SessionStore {
  createSession(input: { title: string; defaults?: TurnSettings }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  /** Newest first. */
  listSessions(): Promise<SessionSummary[]>;
  updateSession(
    id: string,
    patch: Partial<Pick<Session, "title" | "headId" | "status" | "memory" | "queue" | "defaults">>,
  ): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  appendMessage(message: ChatMessage): Promise<void>;
  /** The whole tree, in creation order. */
  getMessages(sessionId: string): Promise<ChatMessage[]>;

  /** Written once, when the turn ends. */
  appendTurn(turn: Turn): Promise<void>;
  getTurns(sessionId: string): Promise<Turn[]>;

  appendEvent(sessionId: string, event: SessionEvent): Promise<void>;
  readEvents(sessionId: string, after: number): Promise<SessionEvent[]>;

  putFile(
    sessionId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<StoredFile>;
  getFile(
    sessionId: string,
    fileId: string,
  ): Promise<{ name: string; mime: string; bytes: Buffer } | null>;
}
