"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BillingModal from "@/components/BillingModal";
import Chat from "@/components/Chat";
import Brand from "@/components/Brand";
import { api, ApiError, ProjectSummary, User } from "@/lib/api";

export default function Studio() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [billing, setBilling] = useState(false);
  const [error, setError] = useState("");

  const refreshProjects = useCallback(async () => {
    const r = await api<{ conversations: ProjectSummary[] }>("/conversations");
    setProjects(r.conversations);
    return r.conversations;
  }, []);

  const refreshUser = useCallback(async () => {
    const r = await api<{ user: User }>("/auth/me");
    setUser(r.user);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshUser();
        const list = await refreshProjects();
        if (list.length) setActiveId(list[0].id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setError(e instanceof Error ? e.message : "Could not load your account");
      }
    })();
  }, [refreshUser, refreshProjects, router]);

  async function newProject() {
    setError("");
    try {
      const r = await api<{ conversation: { id: string }; credits: number }>("/conversations", { body: {} });
      setUser((u) => (u ? { ...u, credits: r.credits } : u));
      await refreshProjects();
      setActiveId(r.conversation.id);
      setMenuOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setBilling(true);
      setError(e instanceof Error ? e.message : "Could not create a product");
    }
  }

  async function logout() {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/");
  }

  const handleRunFinished = useCallback(() => {
    void refreshProjects();
    void refreshUser();
  }, [refreshProjects, refreshUser]);

  if (!user && !error) return <div className="auth-wrap"><p className="note">Loading…</p></div>;

  const active = projects.find((p) => p.id === activeId);

  return (
    <div className="studio">
      <aside className={`side ${menuOpen ? "open" : ""}`}>
        <div className="side-top">
          <Brand onDark height={30} />
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={newProject}>+ New product</button>
          <div className="credits">
            <span>Credits</span>
            <span><strong>{user?.credits ?? 0}</strong> <button className="btn btn-ghost btn-small" style={{ marginLeft: 8 }} onClick={() => setBilling(true)}>Add</button></span>
          </div>
        </div>
        <div className="proj-list">
          {projects.length === 0 && <p className="note" style={{ padding: 12, color: "#aeb9cc" }}>No products yet. Start your first one.</p>}
          {projects.map((p) => (
            <button key={p.id} className={`proj ${p.id === activeId ? "active" : ""}`} onClick={() => { setActiveId(p.id); setMenuOpen(false); }}>
              {p.title}
              <small>{new Date(p.updated_at.replace(" ", "T") + "Z").toLocaleDateString()}</small>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <span>{user?.name}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>

      <section className="main">
        {error && (
          <div className="error" style={{ padding: "10px 22px", background: "#fdecea" }} role="alert">
            {error} <button className="chip" onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <div style={{ padding: "8px 14px" }} className="menu-btn">
          <button className="btn btn-ghost btn-small" onClick={() => setMenuOpen((o) => !o)}>☰ Products</button>
        </div>
        {active ? (
          <Chat key={active.id} conversationId={active.id} title={active.title} onRunFinished={handleRunFinished} onError={setError} />
        ) : (
          <div className="empty" style={{ margin: "auto" }}>
            <h2>Start your first product</h2>
            <p>Each product has its own conversation and files.</p>
            <button className="btn btn-primary" onClick={newProject}>+ New product</button>
          </div>
        )}
      </section>

      {billing && <BillingModal onClose={() => setBilling(false)} onCredits={(n) => setUser((u) => (u ? { ...u, credits: n } : u))} />}
    </div>
  );
}
