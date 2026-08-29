import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * Encryption at rest for per-user secrets (GitHub tokens, MCP env/headers). AES-256-GCM with one
 * controller key: `SECRETS_KEY` (32 bytes, hex or base64) or, for self-hosters who set nothing, a key
 * generated once into `DATA_DIR/secrets.key` (0600). Losing the key loses the secrets — back it up
 * with the data directory. Ciphertext is `v1.<iv>.<tag>.<ct>` in base64url.
 */
export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function keyFromEnvOrFile(env: string | undefined, dataDir: string): Buffer {
  if (env) {
    const b = /^[0-9a-f]{64}$/i.test(env.trim()) ? Buffer.from(env.trim(), "hex") : Buffer.from(env.trim(), "base64");
    if (b.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes (64 hex chars or base64)");
    return b;
  }
  mkdirSync(dataDir, { recursive: true });
  const p = join(dataDir, "secrets.key");
  if (existsSync(p)) {
    const b = Buffer.from(readFileSync(p, "utf8").trim(), "hex");
    if (b.length === 32) return b;
  }
  const b = crypto.randomBytes(32);
  writeFileSync(p, b.toString("hex") + "\n", { mode: 0o600 });
  chmodSync(p, 0o600);
  return b;
}

export function makeSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("secret box key must be 32 bytes");
  return {
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
    },
    open(sealed) {
      const [v, iv, tag, ct] = sealed.split(".");
      if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised ciphertext");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    },
  };
}
