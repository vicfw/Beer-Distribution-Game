import { createHash, randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newId(): string {
  return randomUUID();
}

export function newCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) {
    const symbol = ALPHABET[byte % ALPHABET.length];
    if (symbol === undefined) throw new Error('Code alphabet is empty');
    code += symbol;
  }
  return code;
}

export function newSeatToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
