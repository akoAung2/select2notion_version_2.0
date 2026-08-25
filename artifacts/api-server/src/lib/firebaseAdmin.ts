import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "./logger.js";

let _db: ReturnType<typeof getFirestore> | null = null;
let _ready = false;

function initAdmin(): boolean {
  if (_ready) return true;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) {
    logger.warn("Firebase Admin not configured — FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY required");
    return false;
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");
  if (getApps().length === 0) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  }
  _db = getFirestore();
  _db.settings({ preferRest: true });
  _ready = true;
  logger.info({ projectId }, "Firebase Admin initialised");
  return true;
}

export function getAdminDb(): ReturnType<typeof getFirestore> {
  if (!_ready) {
    const ok = initAdmin();
    if (!ok || !_db) throw new Error("Firebase Admin is not configured");
  }
  return _db!;
}

export function isAdminReady(): boolean {
  if (_ready) return true;
  return initAdmin();
}
