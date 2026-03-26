import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: any[]; // AgentMessage[]
  activeMups: string[]; // MUP IDs that were active
  mupStates: Record<string, unknown>; // saved state data per MUP
  folder: string; // MUP folder path
  gridLayout: any[]; // {id, x, y, w, h}[]
}

const SESSION_DIR = path.join(os.homedir(), ".mup-agent", "sessions");

function ensureDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

export function listSessions(): SessionMeta[] {
  ensureDir();
  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith(".json"));
  const sessions: SessionMeta[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), "utf-8"));
      sessions.push({
        id: raw.id,
        title: raw.title || "Untitled",
        createdAt: raw.createdAt || 0,
        updatedAt: raw.updatedAt || 0,
      });
    } catch {
      // skip corrupt files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): SessionData | null {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function saveSession(data: SessionData): void {
  ensureDir();
  data.updatedAt = Date.now();
  fs.writeFileSync(sessionPath(data.id), JSON.stringify(data), "utf-8");
}

export function deleteSession(id: string): void {
  const p = sessionPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function createSession(title?: string): SessionData {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    id,
    title: title || "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    activeMups: [],
    mupStates: {},
    folder: "",
    gridLayout: [],
  };
}
