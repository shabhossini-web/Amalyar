import { createCipheriv, createDecipheriv } from 'crypto';

function encryptionKey(): Buffer {
  const raw = process.env.TENANT_DATABASE_ENCRYPTION_KEY;
  if (!raw) throw new Error('TENANT_DATABASE_ENCRYPTION_KEY is required');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TENANT_DATABASE_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return key;
}

export function decryptDatabaseUrl(value: string): string {
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Invalid encrypted tenant database URL');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
