// Mock auth for Segment 04 (the build plan explicitly allows "log in or use
// mock auth"). Swapped for Supabase Auth when accounts matter (Segment 5+):
// the rest of the app only touches getUser/signIn/signOut, so the swap is
// contained to this file.
"use client";

export type MockUser = { email: string; displayName: string };

const KEY = "setflow-mock-user";

export function getUser(): MockUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

export function signIn(email: string): MockUser {
  const user: MockUser = { email, displayName: email.split("@")[0] ?? email };
  window.localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

export function signOut(): void {
  window.localStorage.removeItem(KEY);
}
