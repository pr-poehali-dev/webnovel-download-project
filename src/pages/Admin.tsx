import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ADMIN_API, apiFetch } from '@/lib/api';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

interface Stats {
  total_users: number;
  total_downloads: number;
  total_visits: number;
  top_books: { book_title: string; cnt: number; format: string }[];
  recent_visits: { ip: string; country: string; user_agent: string; created_at: string; email: string | null }[];
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string;
  download_count: number;
}

export default function Admin() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'stats' | 'users'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.is_admin) { navigate('/'); }
  }, [user, navigate]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(ADMIN_API, { action: 'stats' }, token);
    if (res.ok) setStats(await res.json());
    setLoading(false);
  }, [token]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(ADMIN_API, { action: 'users' }, token);
    if (res.ok) { const d = await res.json(); setUsers(d.users || []); }
    setLoading(false);
  }, [token]);

  useEffect(() => { if (tab === 'stats') loadStats(); else loadUsers(); }, [tab, loadStats, loadUsers]);

  const toggleAdmin = async (uid: number, current: boolean) => {
    await apiFetch(ADMIN_API, { action: 'set_admin', user_id: uid, is_admin: !current }, token);
    loadUsers();
  };

  const fmtDate = (s: string) => new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtUA = (ua: string) => {
    if (!ua) return '—';
    if (/Android|iPhone|iPad/.test(ua)) return '📱 Мобильный';
    if (/Windows/.test(ua)) return '🖥 Windows';
    if (/Mac/.test(ua)) return '🍎 Mac';
    if (/Linux/.test(ua)) return '🐧 Linux';
    return '🌐 Браузер';
  };

  return (
    <div className="min-h-screen aurora p-4">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors">
            <Icon name="ArrowLeft" size={18} /> На главную
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
              <Icon name="ShieldCheck" size={16} className="text-white" />
            </div>
            <span className="font-display text-xl font-bold">Панель администратора</span>
          </div>
        </div>

        {/* Stat cards */}
        {stats && (
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Пользователей', value: stats.total_users, icon: 'Users' },
              { label: 'Загрузок', value: stats.total_downloads, icon: 'Download' },
              { label: 'Визитов', value: stats.total_visits, icon: 'BarChart2' },
            ].map(c => (
              <div key={c.label} className="glass rounded-2xl p-5 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                  <Icon name={c.icon} size={22} className="text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{c.value}</div>
                  <div className="text-sm text-muted-foreground">{c.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-4 flex gap-2">
          {(['stats', 'users'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-xl px-5 py-2 text-sm font-medium transition-colors ${tab === t ? 'bg-primary text-white' : 'glass text-muted-foreground hover:text-white'}`}>
              {t === 'stats' ? 'Статистика' : 'Пользователи'}
            </button>
          ))}
          <button onClick={() => tab === 'stats' ? loadStats() : loadUsers()} className="ml-auto glass rounded-xl px-4 py-2">
            <Icon name={loading ? 'Loader2' : 'RefreshCw'} size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {tab === 'stats' && stats && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top books */}
            <div className="glass rounded-2xl p-6">
              <h3 className="mb-4 font-display text-lg font-bold flex items-center gap-2">
                <Icon name="BookOpen" size={18} className="text-accent" /> Топ книг
              </h3>
              <div className="space-y-3">
                {stats.top_books.length === 0 && <div className="text-muted-foreground text-sm">Нет данных</div>}
                {stats.top_books.map((b, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-6 text-center text-sm font-bold text-primary">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium">{b.book_title || 'Без названия'}</div>
                      <div className="text-xs text-muted-foreground">{b.format?.toUpperCase()} · {b.cnt} загр.</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent visits */}
            <div className="glass rounded-2xl p-6">
              <h3 className="mb-4 font-display text-lg font-bold flex items-center gap-2">
                <Icon name="Globe" size={18} className="text-accent" /> Последние визиты
              </h3>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {stats.recent_visits.length === 0 && <div className="text-muted-foreground text-sm">Нет данных</div>}
                {stats.recent_visits.map((v, i) => (
                  <div key={i} className="rounded-xl bg-secondary/30 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{v.country || '🌍 Неизвестно'}</span>
                      <span className="text-muted-foreground">{fmtDate(v.created_at)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                      <span>{fmtUA(v.user_agent)}</span>
                      {v.email && <span className="truncate">· {v.email}</span>}
                      {v.ip && <span className="ml-auto font-mono">{v.ip}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="glass rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-muted-foreground">
                  <th className="px-4 py-3">Пользователь</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Email</th>
                  <th className="px-4 py-3 hidden md:table-cell">Загрузок</th>
                  <th className="px-4 py-3 hidden md:table-cell">Дата</th>
                  <th className="px-4 py-3">Роль</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{u.name || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{u.email}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{u.download_count}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      {u.email === 'latikant82@gmail.com' ? (
                        <span className="rounded-lg bg-primary/20 px-2 py-1 text-xs font-semibold text-primary">Супер-адмін</span>
                      ) : (
                        <Button size="sm" variant={u.is_admin ? 'default' : 'outline'}
                          onClick={() => toggleAdmin(u.id, u.is_admin)}
                          className="h-7 rounded-lg px-3 text-xs">
                          {u.is_admin ? 'Адмін' : 'Юзер'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loading && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Нет пользователей</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
