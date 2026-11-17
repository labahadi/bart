'use client';

import { useCallback, useState, type SetStateAction } from 'react';

// Remembers what each tab last showed, for as long as the app is open, so switching
// back to a tab shows its content right away while fresh data loads in the background.
const memory = new Map<string, unknown>();

export function useRemembered<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      memory.set(key, v);
      return v;
    });
  }, [key]);
  return [value, set] as const;
}

export const recall = <T,>(key: string): T | undefined => memory.get(key) as T | undefined;
export const remember = (key: string, value: unknown) => { memory.set(key, value); };
// Called when someone signs in or out, so one person never sees another's data
export const forgetRemembered = () => memory.clear();
