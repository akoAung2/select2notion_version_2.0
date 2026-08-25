const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "select2notion-4f716";
const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

interface JwkKey {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg: string;
  use: string;
}

let cachedKeys: JwkKey[] = [];
let cacheExpiresAt = 0;

async function getPublicKeys(): Promise<JwkKey[]> {
  if (Date.now() < cacheExpiresAt && cachedKeys.length > 0) {
    return cachedKeys;
  }
  const resp = await fetch(FIREBASE_CERTS_URL);
  const cacheControl = resp.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiresAt = Date.now() + maxAge * 1000;
  const json = (await resp.json()) as { keys: JwkKey[] };
  cachedKeys = json.keys;
  return cachedKeys;
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

function parseJwtPart(part: string): unknown {
  return JSON.parse(base64UrlDecode(part).toString("utf-8"));
}

export interface FirebaseTokenPayload {
  uid: string;
  email?: string;
}

export async function verifyFirebaseToken(
  token: string,
): Promise<FirebaseTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT");
  }

  const [headerB64, payloadB64, sigB64] = parts;

  const header = parseJwtPart(headerB64) as { kid: string; alg: string };
  const payload = parseJwtPart(payloadB64) as {
    sub: string;
    iss: string;
    aud: string;
    exp: number;
    iat: number;
    email?: string;
  };

  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) {
    throw new Error("Invalid token issuer");
  }
  if (payload.aud !== PROJECT_ID) {
    throw new Error("Invalid token audience");
  }
  if (payload.exp <= now) {
    throw new Error("Token has expired");
  }
  if (payload.iat > now + 300) {
    throw new Error("Token issued in the future");
  }

  const keys = await getPublicKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error("Unknown signing key — try again after token refresh");
  }

  const cryptoKey = await (crypto.subtle.importKey as any)(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBytes = base64UrlDecode(sigB64);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new Uint8Array(sigBytes),
    new TextEncoder().encode(signingInput),
  );

  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return { uid: payload.sub, email: payload.email };
}
