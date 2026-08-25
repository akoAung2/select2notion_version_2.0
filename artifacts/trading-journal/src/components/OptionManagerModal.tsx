import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Edit3, Trash2, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetNotionSchemaQueryKey } from "@workspace/api-client-react";
import { auth } from "../lib/firebase";

interface Option {
  id: string;
  name: string;
  color?: string;
}

interface OptionManagerModalProps {
  propertyName: string;
  propertyType: "select" | "multi_select" | "status";
  options: Option[];
  onClose: () => void;
}

const BASE = "/api/notion/property-options";

async function apiCall(method: "POST" | "PATCH" | "DELETE", body: Record<string, string>) {
  const idToken = await auth.currentUser?.getIdToken();
  const resp = await fetch(BASE, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) throw new Error(data.message || "Request failed");
  return data;
}

export default function OptionManagerModal({ propertyName, propertyType, options, onClose }: OptionManagerModalProps) {
  const queryClient = useQueryClient();
  const [localOptions, setLocalOptions] = useState<Option[]>(options);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function flash(msg: string, isError = false) {
    if (isError) { setError(msg); setTimeout(() => setError(""), 3000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setLoading("add");
    setError("");
    try {
      await apiCall("POST", { propertyName, optionName: name });
      const tempId = `new_${Date.now()}`;
      setLocalOptions((prev) => [...prev, { id: tempId, name }]);
      setNewName("");
      flash(`"${name}" added`);
      queryClient.invalidateQueries({ queryKey: getGetNotionSchemaQueryKey() });
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : "Failed to add option", true);
    } finally {
      setLoading(null);
    }
  }

  async function handleRename(optionId: string) {
    const name = editingName.trim();
    if (!name) return;
    setLoading(`rename_${optionId}`);
    setError("");
    try {
      await apiCall("PATCH", { propertyName, optionId, newName: name });
      setLocalOptions((prev) => prev.map((o) => o.id === optionId ? { ...o, name } : o));
      setEditingId(null);
      flash(`Renamed to "${name}"`);
      queryClient.invalidateQueries({ queryKey: getGetNotionSchemaQueryKey() });
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : "Failed to rename option", true);
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete(optionId: string, optionName: string) {
    if (!window.confirm(`Delete "${optionName}"? This removes it from all existing trades.`)) return;
    setLoading(`del_${optionId}`);
    setError("");
    try {
      await apiCall("DELETE", { propertyName, optionId });
      setLocalOptions((prev) => prev.filter((o) => o.id !== optionId));
      flash(`"${optionName}" deleted`);
      queryClient.invalidateQueries({ queryKey: getGetNotionSchemaQueryKey() });
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : "Failed to delete option", true);
    } finally {
      setLoading(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="w-full max-w-sm rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "var(--app-card)", border: "1px solid var(--app-border)", maxHeight: "90dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full flex-shrink-0" style={{ background: "linear-gradient(90deg, var(--app-primary), var(--app-secondary))" }} />

        <div className="p-6 flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-black text-base" style={{ color: "var(--app-text)" }}>
                Manage Options
              </h3>
              <p className="text-[10px] font-black uppercase tracking-widest mt-0.5" style={{ color: "var(--app-muted-color)" }}>
                {propertyName} · {propertyType}
              </p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "var(--app-bg)", color: "var(--app-muted-color)" }}>
              <X size={14} />
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs font-medium"
                style={{ background: "color-mix(in srgb, var(--app-danger) 10%, transparent)", color: "var(--app-danger)", border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)" }}>
                <AlertCircle size={12} /> {error}
              </motion.div>
            )}
            {success && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs font-medium"
                style={{ background: "color-mix(in srgb, var(--app-success) 10%, transparent)", color: "var(--app-success)", border: "1px solid color-mix(in srgb, var(--app-success) 20%, transparent)" }}>
                <CheckCircle size={12} /> {success}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2 mb-4 flex-1 overflow-y-auto pr-1 min-h-0">
            {localOptions.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: "var(--app-muted-color)" }}>No options yet. Add one below.</p>
            )}
            {localOptions.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: "var(--app-bg)", border: "1px solid var(--app-border)" }}>
                {editingId === opt.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(opt.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 bg-transparent text-sm font-medium outline-none"
                    style={{ color: "var(--app-text)" }}
                  />
                ) : (
                  <span className="flex-1 text-sm font-medium" style={{ color: "var(--app-text)" }}>{opt.name}</span>
                )}

                {editingId === opt.id ? (
                  <button onClick={() => handleRename(opt.id)} disabled={loading === `rename_${opt.id}`}
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "color-mix(in srgb, var(--app-success) 15%, transparent)", color: "var(--app-success)" }}>
                    {loading === `rename_${opt.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  </button>
                ) : (
                  <button onClick={() => { setEditingId(opt.id); setEditingName(opt.name); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100"
                    style={{ background: "var(--app-card)", color: "var(--app-muted-color)" }}>
                    <Edit3 size={12} />
                  </button>
                )}

                <button onClick={() => handleDelete(opt.id, opt.name)} disabled={!!loading}
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ color: "var(--app-muted-color)" }}>
                  {loading === `del_${opt.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder="New option name..."
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "var(--app-bg)",
                border: "1px solid var(--app-border)",
                color: "var(--app-text)",
              }}
            />
            <button onClick={handleAdd} disabled={!newName.trim() || loading === "add"}
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: newName.trim() ? "var(--app-primary)" : "var(--app-bg)",
                color: newName.trim() ? "var(--app-primary-fg)" : "var(--app-muted-color)",
                border: "1px solid var(--app-border)",
              }}>
              {loading === "add" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
