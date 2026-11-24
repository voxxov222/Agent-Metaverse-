import crypto from 'crypto';

interface EncryptedSecret {
  id: string;
  label: string;
  provider: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  maskedPreview: string;
  updatedAt: number;
}

export interface TenantSession {
  token: string;
  tenantId: string;
  operatorEmail: string;
  role: 'Admin' | 'Operator' | 'Viewer';
  createdAt: number;
}

const masterKeySource = process.env.VAULT_MASTER_KEY?.trim();
const MASTER_KEY = masterKeySource
  ? crypto.createHash('sha256').update(masterKeySource).digest()
  : crypto.randomBytes(32);

const secrets = new Map<string, EncryptedSecret>();
const activeSessions = new Map<string, TenantSession>();

// Admin claim state (per securecoder-persona: env var overrides, otherwise first-run claimable)
let claimedPasscodeHash: { salt: string; hash: string } | null = null;

function hashPasscode(passcode: string, salt?: string): { salt: string; hash: string } {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, s, 64).toString('hex');
  return { salt: s, hash: derived };
}

export function isAdminClaimed(): boolean {
  return Boolean(process.env.VCALABS_ADMIN_PASSCODE?.trim() || claimedPasscodeHash);
}

export function claimOrVerifyAdminPasscode(
  passcode: string,
  operatorEmail = 'vcaslabs@gmail.com',
  role: 'Admin' | 'Operator' | 'Viewer' = 'Admin',
): { ok: boolean; session?: TenantSession; error?: string } {
  const trimmed = passcode.trim();
  if (trimmed.length < 6) {
    return { ok: false, error: 'Passcode must be at least 6 characters.' };
  }

  const envPasscode = process.env.VCALABS_ADMIN_PASSCODE?.trim();
  if (envPasscode) {
    const a = Buffer.from(trimmed);
    const b = Buffer.from(envPasscode);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: 'Invalid operator passcode.' };
    }
  } else if (!claimedPasscodeHash) {
    claimedPasscodeHash = hashPasscode(trimmed);
  } else {
    const attempt = hashPasscode(trimmed, claimedPasscodeHash.salt);
    const a = Buffer.from(attempt.hash, 'hex');
    const b = Buffer.from(claimedPasscodeHash.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: 'Invalid operator passcode.' };
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const session: TenantSession = {
    token,
    tenantId: 'tenant-primary',
    operatorEmail,
    role,
    createdAt: Date.now(),
  };
  activeSessions.set(token, session);
  return { ok: true, session };
}

export function getSessionFromHeader(authHeader?: string): TenantSession | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return activeSessions.get(match[1].trim()) ?? null;
}

export function revokeSession(token: string): void {
  activeSessions.delete(token);
}

export function storeEncryptedSecret(id: string, label: string, provider: string, plaintext: string): {
  id: string;
  label: string;
  provider: string;
  maskedPreview: string;
  updatedAt: number;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const tail = plaintext.slice(-4);
  const maskedPreview = plaintext.length > 4 ? `••••${tail}` : '••••';

  const record: EncryptedSecret = {
    id,
    label,
    provider,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
    maskedPreview,
    updatedAt: Date.now(),
  };
  secrets.set(id, record);
  return {
    id: record.id,
    label: record.label,
    provider: record.provider,
    maskedPreview: record.maskedPreview,
    updatedAt: record.updatedAt,
  };
}

export function decryptSecretInternal(id: string): string | null {
  const record = secrets.get(id);
  if (!record) return null;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    MASTER_KEY,
    Buffer.from(record.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

export function listMaskedSecrets(): Array<{
  id: string;
  label: string;
  provider: string;
  maskedPreview: string;
  updatedAt: number;
}> {
  return Array.from(secrets.values()).map((r) => ({
    id: r.id,
    label: r.label,
    provider: r.provider,
    maskedPreview: r.maskedPreview,
    updatedAt: r.updatedAt,
  }));
}

export function deleteSecret(id: string): boolean {
  return secrets.delete(id);
}
