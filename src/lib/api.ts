export const WEBNOVEL_API = 'https://functions.poehali.dev/a4df85d2-e037-42d4-9d2f-8ae54e96cfaa';
export const AUTH_API = 'https://functions.poehali.dev/fbbeb2d2-dd06-4735-b2f5-5fc7762edd4c';
export const ADMIN_API = 'https://functions.poehali.dev/7e7f1cc2-4366-4efd-a721-9613ac06c537';
export const TRANSLATE_API = 'https://functions.poehali.dev/62c25d21-3a3d-41d3-98ed-57fea09dfb74';

export interface User {
  id: number;
  email: string;
  name: string;
  avatar: string;
  is_admin: boolean;
}

export async function apiFetch(url: string, body: object, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return res;
}