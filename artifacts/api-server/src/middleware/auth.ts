import type { Request, Response, NextFunction } from "express";
import { verifyFirebaseToken } from "../lib/firebaseVerify.js";
import { logger } from "../lib/logger.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "select2notion-4f716";

declare global {
  namespace Express {
    interface Request {
      uid?: string;
      idToken?: string;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await verifyFirebaseToken(token);
    req.uid = decoded.uid;
    req.idToken = token;
    next();
  } catch (err) {
    logger.warn({ err }, "Token verification failed");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export interface NotionCredentials {
  notion_token: string;
  notion_database_id: string;
}

export async function getUserNotionCredentials(
  uid: string,
  idToken: string,
): Promise<NotionCredentials | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/user_connections/${uid}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const fields = data.fields as Record<string, { stringValue?: string }> | undefined;
    const notion_token = fields?.notion_token?.stringValue;
    const notion_database_id = fields?.notion_database_id?.stringValue;
    if (!notion_token || !notion_database_id) return null;
    return { notion_token, notion_database_id };
  } catch (err) {
    logger.error({ err, uid }, "Failed to load user Notion credentials");
    return null;
  }
}
