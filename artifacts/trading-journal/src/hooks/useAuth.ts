import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "approved"
  | "no-access";

export interface AuthResult {
  user: User | null;
  status: AuthStatus;
  isOwner: boolean;
  notionConnected: boolean | null;
  refetchNotionStatus: () => Promise<void>;
  disconnectNotion: () => Promise<void>;
}

export function useAuth(): AuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [isOwner, setIsOwner] = useState(false);
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);

  const checkNotionConnection = useCallback(async (firebaseUser: User) => {
    try {
      const snap = await getDoc(doc(db, "user_connections", firebaseUser.uid));
      setNotionConnected(snap.exists());
    } catch {
      setNotionConnected(false);
    }
  }, []);

  const refetchNotionStatus = useCallback(async () => {
    if (!user) return;
    await checkNotionConnection(user);
  }, [user, checkNotionConnection]);

  const disconnectNotion = useCallback(async () => {
    if (!user) return;
    await deleteDoc(doc(db, "user_connections", user.uid));
    setNotionConnected(false);
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setNotionConnected(null);

      if (!firebaseUser) {
        setStatus("unauthenticated");
        setIsOwner(false);
        return;
      }

      const email = (firebaseUser.email ?? "").toLowerCase();

      try {
        const ownerSnap = await getDoc(doc(db, "owners", email));
        if (ownerSnap.exists() && ownerSnap.data()?.isOwner === true) {
          setIsOwner(true);
          setStatus("approved");
          await checkNotionConnection(firebaseUser);
          return;
        }

        const approvedSnap = await getDoc(doc(db, "approvedUsers", email));
        if (approvedSnap.exists() && approvedSnap.data()?.approved === true) {
          setIsOwner(false);
          setStatus("approved");
          await checkNotionConnection(firebaseUser);
          return;
        }

        await setDoc(
          doc(db, "accessRequests", email),
          {
            email,
            displayName: firebaseUser.displayName ?? "",
            photoURL: firebaseUser.photoURL ?? "",
            requestedAt: serverTimestamp(),
          },
          { merge: true },
        );

        setIsOwner(false);
        setStatus("no-access");
      } catch (err) {
        console.error("[useAuth] Firestore error:", err);
        setIsOwner(false);
        setStatus("no-access");
      }
    });

    return unsubscribe;
  }, [checkNotionConnection]);

  return { user, status, isOwner, notionConnected, refetchNotionStatus, disconnectNotion };
}
