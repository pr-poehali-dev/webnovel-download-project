import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, AUTH_API, apiFetch } from '@/lib/api';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (googleToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null, token: null, loading: true,
  login: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('ng_token');
    if (!saved) { setLoading(false); return; }
    apiFetch(AUTH_API, { action: 'me' }, saved)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) { setUser(data.user); setToken(saved); }
        else localStorage.removeItem('ng_token');
      })
      .catch(() => localStorage.removeItem('ng_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (googleToken: string) => {
    const res = await apiFetch(AUTH_API, { action: 'google_login', token: googleToken });
    if (!res.ok) throw new Error('Ошибка авторизации');
    const data = await res.json();
    localStorage.setItem('ng_token', data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    if (token) await apiFetch(AUTH_API, { action: 'logout' }, token).catch(() => {});
    localStorage.removeItem('ng_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
