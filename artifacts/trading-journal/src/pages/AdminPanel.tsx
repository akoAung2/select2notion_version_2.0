import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { UserCheck, UserX, UserPlus, ShieldCheck, Clock, Trash2, Loader2 } from "lucide-react";

interface UserRecord {
  email: string;
  displayName?: string;
  photoURL?: string;
  requestedAt?: Timestamp;
}

type Tab = "approved" | "requests";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("approved");
  const [approvedUsers, setApprovedUsers] = useState<UserRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<UserRecord[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [approvedSnap, requestsSnap] = await Promise.all([
        getDocs(collection(db, "approvedUsers")),
        getDocs(collection(db, "accessRequests")),
      ]);
      setApprovedUsers(approvedSnap.docs.map((d) => ({ email: d.id, ...d.data() } as UserRecord)));
      setAccessRequests(requestsSnap.docs.map((d) => ({ email: d.id, ...d.data() } as UserRecord)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function showFeedback(msg: string, ok: boolean) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function approveUser(email: string) {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    setActionLoading(clean);
    try {
      await setDoc(doc(db, "approvedUsers", clean), { approved: true });
      // Remove from access requests if present
      await deleteDoc(doc(db, "accessRequests", clean));
      showFeedback(`${clean} approved.`, true);
      await loadData();
    } catch {
      showFeedback("Failed to approve user.", false);
    } finally {
      setActionLoading(null);
      setNewEmail("");
    }
  }

  async function removeUser(email: string) {
    setActionLoading(email);
    try {
      await deleteDoc(doc(db, "approvedUsers", email));
      showFeedback(`${email} removed.`, true);
      await loadData();
    } catch {
      showFeedback("Failed to remove user.", false);
    } finally {
      setActionLoading(null);
    }
  }

  async function denyRequest(email: string) {
    setActionLoading(email);
    try {
      await deleteDoc(doc(db, "accessRequests", email));
      showFeedback(`Request from ${email} dismissed.`, true);
      await loadData();
    } catch {
      showFeedback("Failed to dismiss request.", false);
    } finally {
      setActionLoading(null);
    }
  }

  const card = {
    background: "var(--app-card)",
    border: "1px solid var(--app-border)",
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: "var(--app-primary)" }}
        >
          <ShieldCheck size={20} color="white" />
        </div>
        <div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--app-text)" }}>
            Admin Control Center
          </h2>
          <p className="text-sm font-medium mt-0.5" style={{ color: "var(--app-muted-color)" }}>
            Only visible to you. Manage who can access this app.
          </p>
        </div>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Approved Users", value: approvedUsers.length, icon: UserCheck, color: "var(--app-success, #22c55e)" },
          { label: "Pending Requests", value: accessRequests.length, icon: Clock, color: "var(--app-warning, #f59e0b)" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="p-5 rounded-2xl flex items-center gap-4" style={card}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <p className="text-2xl font-black" style={{ color: "var(--app-text)" }}>{value}</p>
              <p className="text-xs font-medium" style={{ color: "var(--app-muted-color)" }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Add user */}
      <div className="p-5 rounded-2xl space-y-3" style={card}>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--app-muted-color)" }}>
          Add User by Email
        </p>
        <div className="flex gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && approveUser(newEmail)}
            placeholder="user@example.com"
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium outline-none"
            style={{
              background: "var(--app-bg)",
              border: "1px solid var(--app-border)",
              color: "var(--app-text)",
            }}
          />
          <button
            onClick={() => approveUser(newEmail)}
            disabled={!newEmail.trim() || actionLoading === newEmail.trim().toLowerCase()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
          >
            {actionLoading === newEmail.trim().toLowerCase() ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <UserPlus size={16} />
            )}
            Approve
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className="px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            background: feedback.ok
              ? "color-mix(in srgb, #22c55e 10%, transparent)"
              : "color-mix(in srgb, var(--app-danger) 10%, transparent)",
            border: `1px solid ${feedback.ok ? "color-mix(in srgb, #22c55e 25%, transparent)" : "color-mix(in srgb, var(--app-danger) 25%, transparent)"}`,
            color: feedback.ok ? "#16a34a" : "var(--app-danger)",
          }}
        >
          {feedback.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(["approved", "requests"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="px-4 py-2 rounded-xl text-sm font-bold capitalize transition-all"
            style={{
              background: activeTab === t ? "var(--app-primary)" : "var(--app-card)",
              border: "1px solid var(--app-border)",
              color: activeTab === t ? "var(--app-primary-fg)" : "var(--app-muted-color)",
            }}
          >
            {t === "approved" ? `Approved Users (${approvedUsers.length})` : `Access Requests (${accessRequests.length})`}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-2xl overflow-hidden" style={card}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--app-primary)" }} />
          </div>
        ) : activeTab === "approved" ? (
          approvedUsers.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: "var(--app-muted-color)" }}>
              No approved users yet. Add one above.
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
              {approvedUsers.map((u) => (
                <li key={u.email} className="flex items-center gap-3 px-5 py-4">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                    style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
                  >
                    {u.email[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--app-text)" }}>{u.email}</p>
                    {u.displayName && (
                      <p className="text-xs truncate" style={{ color: "var(--app-muted-color)" }}>{u.displayName}</p>
                    )}
                  </div>
                  <span
                    className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                    style={{ background: "color-mix(in srgb, #22c55e 12%, transparent)", color: "#16a34a" }}
                  >
                    Approved
                  </span>
                  <button
                    onClick={() => removeUser(u.email)}
                    disabled={actionLoading === u.email}
                    className="p-2 rounded-xl transition-all disabled:opacity-50"
                    style={{ color: "var(--app-danger)" }}
                    title="Remove access"
                  >
                    {actionLoading === u.email ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          accessRequests.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: "var(--app-muted-color)" }}>
              No pending access requests.
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
              {accessRequests.map((u) => (
                <li key={u.email} className="flex items-center gap-3 px-5 py-4">
                  {u.photoURL ? (
                    <img src={u.photoURL} className="w-8 h-8 rounded-full shrink-0" alt="" />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                      style={{ background: "var(--app-border)", color: "var(--app-muted-color)" }}
                    >
                      {u.email[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--app-text)" }}>{u.email}</p>
                    {u.displayName && (
                      <p className="text-xs truncate" style={{ color: "var(--app-muted-color)" }}>{u.displayName}</p>
                    )}
                  </div>
                  <span
                    className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg"
                    style={{ background: "color-mix(in srgb, #f59e0b 12%, transparent)", color: "#b45309" }}
                  >
                    Pending
                  </span>
                  <button
                    onClick={() => approveUser(u.email)}
                    disabled={actionLoading === u.email}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                    style={{ background: "var(--app-primary)", color: "var(--app-primary-fg)" }}
                  >
                    {actionLoading === u.email ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                    Approve
                  </button>
                  <button
                    onClick={() => denyRequest(u.email)}
                    disabled={actionLoading === u.email}
                    className="p-2 rounded-xl transition-all disabled:opacity-50"
                    style={{ color: "var(--app-danger)" }}
                    title="Dismiss request"
                  >
                    <UserX size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
