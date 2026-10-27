"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, ChatMessage, ConversationDetail, fileUrl, FileInfo, formatBytes, streamUrl } from "@/lib/api";

type ToolItem = { callId: string; label: string; status: "start" | "done" | "error" };
type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; status: "start" | "done" | "error"; callId: string; label: string }
  | { type: "file"; file: FileInfo }
  | { type: "done" }
  | { type: "error"; message: string };

const STARTERS = [
  "Create a digital product about managing money for first-job earners in India",
  "Create a digital product about beginner yoga for desk workers over 40",
  "Create a digital product about learning English speaking for college students",
];

function Md({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
}

export default function Chat({
  conversationId,
  title,
  onRunFinished,
  onError,
}: {
  conversationId: string;
  title: string;
  onRunFinished: () => void;
  onError: (msg: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [live, setLive] = useState("");
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState("");
  const [loadError, setLoadError] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const stopStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const load = useCallback(async () => {
    const d = await api<ConversationDetail>(`/conversations/${conversationId}`);
    setMessages(d.messages);
    setFiles(d.files);
    return d;
  }, [conversationId]);

  const follow = useCallback(
    (runId: string) => {
      stopStream();
      setRunning(true);
      setLive("");
      setTools([]);
      const es = new EventSource(streamUrl(runId), { withCredentials: true });
      esRef.current = es;
      let finished = false;
      const finish = async () => {
        finished = true;
        stopStream();
        setRunning(false);
        setLive("");
        setTools([]);
        try { await load(); } catch { /* ignore */ }
        onRunFinished();
      };
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as StreamEvent;
        if (e.type === "text") setLive((t) => t + e.delta);
        else if (e.type === "tool") {
          setTools((list) => {
            const i = list.findIndex((x) => x.callId === e.callId && x.label === e.label);
            if (i >= 0) { const copy = [...list]; copy[i] = { callId: e.callId, label: e.label, status: e.status }; return copy; }
            return [...list, { callId: e.callId, label: e.label, status: e.status }];
          });
        } else if (e.type === "file") {
          setFiles((fs) => (fs.some((f) => f.id === e.file.id) ? fs.map((f) => (f.id === e.file.id ? e.file : f)) : [...fs, e.file]));
        } else if (e.type === "error") { onError(e.message); void finish(); }
        else if (e.type === "done") void finish();
      };
      es.onerror = () => {
        // The server closes the stream after done/error, which also fires onerror. Only react if we were cut off.
        if (finished) return;
        stopStream();
        setRunning(false);
        setTimeout(() => { void load().catch(() => {}); }, 1500);
        onError("Lost the live connection. Your files are still being saved; reload in a moment to see them.");
      };
    },
    [load, onError, onRunFinished, stopStream]
  );

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setFiles([]); setLive(""); setTools([]); setRunning(false); setLoadError("");
    load()
      .then((d) => { if (!cancelled && d.activeRunId) follow(d.activeRunId); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load this product"); });
    return () => { cancelled = true; stopStream(); };
  }, [conversationId, load, follow, stopStream]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, live, tools, files]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || running) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: t }]);
    try {
      const { runId } = await api<{ runId: string }>(`/conversations/${conversationId}/messages`, { body: { text: t } });
      follow(runId);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not send your message");
      void load().catch(() => {});
    }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
  };

  const empty = messages.length === 0 && !running && !live;

  return (
    <>
      <div className="main-head">
        <h2>{title}</h2>
        {running && <span className="note">Working… you can keep this page open</span>}
      </div>
      <div className="chat">
        <div className="chat-inner">
          {loadError && <p className="error">{loadError}</p>}
          {empty && !loadError && (
            <div className="empty">
              <h2>What should we build?</h2>
              <p>Describe the topic and who it is for. I will ask for anything I still need.</p>
              <div className="chips">
                {STARTERS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === "assistant" ? <Md text={m.text} /> : m.text}
            </div>
          ))}
          {tools.length > 0 && (
            <div className="toollog" aria-live="polite">
              {tools.map((t) => (
                <div key={t.callId + t.label} className={`tool ${t.status === "start" ? "" : t.status}`}>
                  <span className="dot" />
                  {t.label}
                </div>
              ))}
            </div>
          )}
          {live && <div className="bubble assistant"><Md text={live} /></div>}
          {files.length > 0 && (
            <div className="files">
              {files.map((f) => (
                <div className="filecard" key={f.id}>
                  <div><b>{f.filename}</b><small>{formatBytes(f.bytes)}</small></div>
                  <a className="btn btn-primary btn-small" href={fileUrl(f.id)}>Download</a>
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <div className="composer-inner">
          <textarea
            className="input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={running ? "Working…" : "Describe your product, or ask for a change…"}
            disabled={running}
            maxLength={8000}
            aria-label="Message"
          />
          <button className="btn btn-primary" disabled={running || !input.trim()}>Send</button>
        </div>
      </form>
    </>
  );
}
