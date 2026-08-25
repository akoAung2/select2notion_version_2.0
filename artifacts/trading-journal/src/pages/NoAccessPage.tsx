import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ShieldOff } from "lucide-react";
import type { User } from "firebase/auth";

interface NoAccessPageProps {
  user: User;
}

// NoAccessPage — shown when the signed-in user is not in the approvedUsers list.
export default function NoAccessPage({ user }: NoAccessPageProps) {
  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: "var(--app-bg)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-8 flex flex-col items-center gap-6 text-center"
        style={{
          background: "var(--app-card)",
          border: "1px solid var(--app-border)",
        }}
      >
        {/* Icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: "color-mix(in srgb, var(--app-danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--app-danger) 20%, transparent)",
          }}
        >
          <ShieldOff size={24} style={{ color: "var(--app-danger)" }} />
        </div>

        <div>
          <h1 className="text-2xl font-black tracking-tight mb-2" style={{ color: "var(--app-text)" }}>
            Access Denied
          </h1>
          <p className="text-sm" style={{ color: "var(--app-muted-color)" }}>
            <span className="font-semibold" style={{ color: "var(--app-text)" }}>
              {user.email}
            </span>{" "}
            is not on the approved users list. Please contact your administrator to request access.
          </p>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full px-6 py-3.5 rounded-2xl font-semibold text-sm transition-all"
          style={{
            background: "var(--app-card)",
            border: "1px solid var(--app-border)",
            color: "var(--app-text)",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
