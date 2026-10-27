export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Digital Product Studio";

export type User = { id: string; email: string; name: string; credits: number };
export type ProjectSummary = { id: string; title: string; created_at: string; updated_at: string };
export type ChatMessage = { role: "user" | "assistant"; text: string };
export type FileInfo = { id: string; filename: string; bytes: number };
export type ConversationDetail = {
  conversation: { id: string; title: string };
  messages: ChatMessage[];
  files: FileInfo[];
  usage: { runs: number; input: number; output: number };
  activeRunId: string | null;
};
export type Pack = { id: string; credits: number; amountInr: number };
export type PacksResponse = { packs: Pack[]; paymentsEnabled: boolean; devGrant: boolean; projectCreditCost: number };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      credentials: "include",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }
  let data: { error?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export const fileUrl = (id: string) => `${API}/api/files/${id}/download`;
export const streamUrl = (runId: string) => `${API}/api/runs/${runId}/stream`;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
