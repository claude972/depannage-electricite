import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

const secure = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const fragmentSize = 400;
const maxFragments = 64;
type Manifest = { generation: string; count: number };

const fragmentKey = (key: string, generation: string, index: number) => `${key}.${generation}.${index}`;

async function manifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key, secure);
  if (!raw) return null;
  const value: Manifest = JSON.parse(raw);
  if (!/^[0-9a-f-]{36}$/.test(value.generation) || !Number.isInteger(value.count) || value.count < 1 || value.count > maxFragments)
    throw new Error('Session sécurisée illisible.');
  return value;
}

async function removeFragments(key: string, value: Manifest | null) {
  if (value) await Promise.allSettled(Array.from({ length: value.count }, (_, index) =>
    SecureStore.deleteItemAsync(fragmentKey(key, value.generation, index), secure)));
}

export const secureStorage = {
  async getItem(key: string) {
    const current = await manifest(key);
    if (!current) return null;
    const pieces = await Promise.all(Array.from({ length: current.count }, (_, index) =>
      SecureStore.getItemAsync(fragmentKey(key, current.generation, index), secure)));
    if (pieces.some(piece => piece === null)) throw new Error('Session sécurisée incomplète.');
    return pieces.join('');
  },
  async setItem(key: string, value: string) {
    const old = await manifest(key);
    const characters = Array.from(value);
    const parts = Array.from({ length: Math.max(1, Math.ceil(characters.length / fragmentSize)) }, (_, index) =>
      characters.slice(index * fragmentSize, (index + 1) * fragmentSize).join(''));
    if (parts.length > maxFragments) throw new Error('Session sécurisée trop volumineuse.');
    const next = { generation: randomUUID(), count: parts.length };
    try {
      for (const [index, piece] of parts.entries()) {
        await SecureStore.setItemAsync(fragmentKey(key, next.generation, index), piece, secure);
      }
      await SecureStore.setItemAsync(key, JSON.stringify(next), secure);
    } catch (error) {
      await removeFragments(key, next);
      throw error;
    }
    await removeFragments(key, old);
  },
  async removeItem(key: string) {
    const old = await manifest(key);
    await SecureStore.deleteItemAsync(key, secure);
    await removeFragments(key, old);
  },
};
