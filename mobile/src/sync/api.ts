const DEFAULT_API = "http://127.0.0.1:8000";

export function apiBase(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API;
  return raw.replace(/\/$/, "");
}

export function followLink(slug: string): string {
  return `${apiBase()}/follow/${slug}`;
}
