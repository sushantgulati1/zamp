import { randomBytes } from 'node:crypto';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateId(size = 10): string {
  const bytes = randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}
