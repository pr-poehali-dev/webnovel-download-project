import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { useNavigate } from 'react-router-dom';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { WEBNOVEL_API, AUTH_API, TRANSLATE_API, apiFetch } from '@/lib/api';

interface Chapter { id: string; index: number; name: string; free: boolean; }
interface DownloadedChapter { id: string; name: string; content: string; }
interface HistoryItem { id?: number; book_title: string; chapter_count: number; format: string; created_at: string; chapters_data?: DownloadedChapter[]; }
interface TranslateState { [chapterId: string]: { status: 'idle' | 'loading' | 'done' | 'error'; text: string; }; }

const formats = [
  { id: 'txt', label: 'TXT', icon: 'FileText', desc: 'Простой текст' },
  { id: 'epub', label: 'EPUB', icon: 'BookOpen', desc: 'Для ридеров' },
  { id: 'html', label: 'HTML', icon: 'Code', desc: 'Для браузера' },
];

const steps = [
  { icon: 'Link2', title: 'Вставь ссылку', text: 'Скопируй URL книги с m.webnovel.com' },
  { icon: 'ListChecks', title: 'Выбери главы', text: 'Диапазон, количество или всю книгу' },
  { icon: 'Download', title: 'Скачай файл', text: 'Только бесплатные главы — в один клик' },
];

// v2 — Google Sign-In via native GSI
export default function Index() {
  const navigate = useNavigate();
  const { user, token, login, logout, loading: authLoading } = useAuth();

  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('txt');
  const [active, setActive] = useState('home');

  const [loadingChapters, setLoadingChapters] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [bookId, setBookId] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [fromCh, setFromCh] = useState(1);
  const [toCh, setToCh] = useState(1);

  // Progress
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  // Downloaded chapters (for preview & translate)
  const [downloadedChapters, setDownloadedChapters] = useState<DownloadedChapter[]>([]);

  // Chapter preview modal
  const [previewChapter, setPreviewChapter] = useState<DownloadedChapter | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Translate
  const [translateState, setTranslateState] = useState<TranslateState>({});
  const [translatingAll, setTranslatingAll] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(0);

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Load chapter list ──────────────────────────────────────────────────────
  const loadChapters = async () => {
    if (!url.trim()) { toast({ title: 'Вставь ссылку на книгу', variant: 'destructive' }); return; }
    setLoadingChapters(true);
    setChapters([]);
    setDownloadedChapters([]);
    setTranslateState({});
    try {
      const res = await fetch(WEBNOVEL_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chapters', url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: 'Не удалось загрузить главы', description: data.error, variant: 'destructive' }); return; }
      setBookTitle(data.title);
      setBookId(extractBookId(url));
      setChapters(data.chapters);
      setFromCh(1);
      setToCh(data.chapters.length);
      toast({ title: `Найдено ${data.chapters.length} бесплатных глав`, description: data.title });
      scrollTo('download');
    } catch { toast({ title: 'Ошибка сети', variant: 'destructive' }); }
    finally { setLoadingChapters(false); }
  };

  // ── Preview single chapter ─────────────────────────────────────────────────
  const previewSingle = async (ch: Chapter) => {
    setPreviewLoading(true);
    setPreviewChapter({ id: ch.id, name: ch.name, content: '' });
    try {
      const res = await fetch(WEBNOVEL_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', url: url.trim(), chapterIds: [ch.id] }),
      });
      const data = await res.json();
      const ch0 = data.chapters?.[0];
      if (ch0) setPreviewChapter({ id: ch0.id, name: ch0.name, content: ch0.content });
    } catch { toast({ title: 'Ошибка при загрузке главы', variant: 'destructive' }); }
    finally { setPreviewLoading(false); }
  };

  // ── Download selected chapters ─────────────────────────────────────────────
  const download = async () => {
    if (!chapters.length) return;
    const from = Math.max(1, Math.min(fromCh, chapters.length));
    const to = Math.max(from, Math.min(toCh, chapters.length));
    const selected = chapters.slice(from - 1, to);
    setDownloading(true);
    setProgressDone(0);
    setProgressTotal(selected.length);
    setDownloadedChapters([]);
    setTranslateState({});

    try {
      const res = await fetch(WEBNOVEL_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', url: url.trim(), chapterIds: selected.map(c => c.id) }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: 'Ошибка скачивания', description: data.error, variant: 'destructive' }); return; }

      const chs: DownloadedChapter[] = data.chapters || [];
      // Simulate progressive update
      for (let i = 0; i < chs.length; i++) {
        setProgressDone(i + 1);
        await new Promise(r => setTimeout(r, 10));
      }
      setDownloadedChapters(chs);

      const { blob, ext } = await buildFile(bookTitle, chs, format);
      triggerDownload(blob, `${bookTitle.replace(/[^\w\d]+/g, '_')}.${ext}`);

      // Save to history (local)
      const item: HistoryItem = {
        book_title: bookTitle, chapter_count: chs.length,
        format: format.toUpperCase(), created_at: new Date().toISOString(), chapters_data: chs,
      };
      setHistory(h => [item, ...h]);

      // Save to DB if logged in
      if (token) {
        apiFetch(AUTH_API, {
          action: 'save_download', book_id: bookId, book_title: bookTitle,
          chapter_count: chs.length, format, chapters_data: chs,
        }, token).catch(() => {});
      }

      toast({ title: 'Готово!', description: `${chs.length} глав скачано в ${ext.toUpperCase()}` });
    } catch { toast({ title: 'Ошибка при скачивании', variant: 'destructive' }); }
    finally { setDownloading(false); }
  };

  // ── Translate ──────────────────────────────────────────────────────────────
  const translateChapter = useCallback(async (ch: DownloadedChapter) => {
    setTranslateState(s => ({ ...s, [ch.id]: { status: 'loading', text: '' } }));
    try {
      const res = await fetch(TRANSLATE_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'translate_chapter', text: ch.content, chapter_name: ch.name }),
      });
      const data = await res.json();
      if (res.ok && data.translated) {
        setTranslateState(s => ({ ...s, [ch.id]: { status: 'done', text: data.translated } }));
      } else {
        setTranslateState(s => ({ ...s, [ch.id]: { status: 'error', text: '' } }));
      }
    } catch {
      setTranslateState(s => ({ ...s, [ch.id]: { status: 'error', text: '' } }));
    }
  }, []);

  const translateAll = async () => {
    if (!downloadedChapters.length) return;
    setTranslatingAll(true);
    setTranslateProgress(0);
    const pending = downloadedChapters.filter(ch => !translateState[ch.id] || translateState[ch.id].status === 'idle');
    for (let i = 0; i < pending.length; i++) {
      await translateChapter(pending[i]);
      setTranslateProgress(i + 1);
    }
    setTranslatingAll(false);
  };

  // ── Cloud history ──────────────────────────────────────────────────────────
  const loadCloudHistory = useCallback(async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const res = await apiFetch(AUTH_API, { action: 'get_history' }, token);
      if (res.ok) { const d = await res.json(); setHistory(d.downloads || []); }
    } catch (e) { console.error(e); }
    finally { setHistoryLoading(false); }
  }, [token]);

  const redownloadHistory = async (item: HistoryItem) => {
    if (!item.chapters_data?.length) return;
    const { blob, ext } = await buildFile(item.book_title, item.chapters_data, item.format.toLowerCase());
    triggerDownload(blob, `${item.book_title.replace(/[^\w\d]+/g, '_')}.${ext}`);
  };

  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  const from = Math.max(1, Math.min(fromCh, chapters.length || 1));
  const to = Math.max(from, Math.min(toCh, chapters.length || 1));
  const doneCount = Object.values(translateState).filter(s => s.status === 'done').length;
  const translatePct = downloadedChapters.length > 0 ? Math.round((doneCount / downloadedChapters.length) * 100) : 0;

  return (
    <div className="min-h-screen aurora relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -right-32 h-[30rem] w-[30rem] rounded-full bg-primary/20 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute top-1/2 -left-40 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-3xl animate-float-slow" style={{ animationDelay: '2s' }} />

      {/* Nav */}
      <header className="sticky top-0 z-50">
        <nav className="glass mx-auto mt-4 flex max-w-5xl items-center justify-between rounded-2xl px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
              <Icon name="BookMarked" size={20} className="text-white" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">NovelGrab</span>
          </div>
          <div className="hidden items-center gap-1 md:flex">
            {[{ id: 'home', label: 'Главная' }, { id: 'download', label: 'Загрузка' }, { id: 'history', label: 'История' }].map(n => (
              <button key={n.id} onClick={() => scrollTo(n.id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active === n.id ? 'bg-primary/20 text-white' : 'text-muted-foreground hover:text-white'}`}>
                {n.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!authLoading && (user ? (
              <div className="flex items-center gap-2">
                {user.is_admin && (
                  <button onClick={() => navigate('/admin')} className="flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/30">
                    <Icon name="ShieldCheck" size={14} /> Админ
                  </button>
                )}
                <button onClick={() => { scrollTo('history'); loadCloudHistory(); }} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-secondary/50 transition-colors">
                  {user.avatar && <img src={user.avatar} alt="" className="h-6 w-6 rounded-full" />}
                  <span className="hidden sm:block max-w-[120px] truncate">{user.name}</span>
                </button>
                <button onClick={logout} className="rounded-xl p-1.5 text-muted-foreground hover:text-white transition-colors">
                  <Icon name="LogOut" size={16} />
                </button>
              </div>
            ) : (
              <GoogleSignInButton onToken={login} size="medium" shape="pill" text="signin_with" />
            ))}
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section id="home" className="relative mx-auto max-w-5xl px-4 pb-20 pt-24 text-center">
        <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary">
          <Icon name="Zap" size={14} /> Бесплатные главы WebNovel в один клик
        </div>
        <h1 className="animate-fade-up mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl" style={{ animationDelay: '0.1s' }}>
          Читай книги <span className="text-gradient">где угодно</span>
        </h1>
        <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg text-muted-foreground" style={{ animationDelay: '0.2s' }}>
          Вставь ссылку на книгу с webnovel.com, выбери нужные главы, скачай в TXT, EPUB или HTML — и переведи на русский прямо здесь.
        </p>
        <div className="animate-fade-up mt-10 flex flex-wrap items-center justify-center gap-4" style={{ animationDelay: '0.3s' }}>
          <Button onClick={() => scrollTo('download')} size="lg" className="glow rounded-xl bg-primary px-8 text-base font-semibold hover:bg-primary/90">
            <Icon name="Download" size={18} className="mr-2" /> Начать загрузку
          </Button>
          <Button onClick={() => { scrollTo('history'); if (token) loadCloudHistory(); }} size="lg" variant="outline" className="rounded-xl border-border bg-secondary/50 px-8 text-base hover:bg-secondary">
            Мои книги
          </Button>
        </div>
        <div className="animate-fade-up mt-16 grid gap-4 sm:grid-cols-3" style={{ animationDelay: '0.4s' }}>
          {steps.map((s, i) => (
            <div key={s.title} className="glass rounded-2xl p-6 text-left transition-transform hover:-translate-y-1">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                <Icon name={s.icon} size={22} className="text-accent" />
              </div>
              <div className="mb-1 text-xs font-semibold text-primary">Шаг {i + 1}</div>
              <h3 className="font-display text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Download */}
      <section id="download" className="mx-auto max-w-3xl px-4 pb-20">
        <div className="glass rounded-3xl p-6 md:p-10">
          <div className="mb-2 flex items-center gap-2 text-accent">
            <Icon name="Sparkles" size={18} />
            <span className="text-sm font-semibold uppercase tracking-wider">Загрузчик</span>
          </div>
          <h2 className="font-display text-3xl font-bold">Скачать книгу</h2>
          <p className="mt-2 text-muted-foreground">Вставь ссылку и загрузи список глав.</p>

          <label className="mt-8 block text-sm font-medium text-muted-foreground">Ссылка на книгу</label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="Link2" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadChapters()}
                placeholder="https://m.webnovel.com/book/..." className="h-12 rounded-xl border-border bg-secondary/40 pl-11 text-base" />
            </div>
            <Button onClick={loadChapters} disabled={loadingChapters} size="lg" className="h-12 rounded-xl bg-primary font-semibold hover:bg-primary/90">
              {loadingChapters ? <Icon name="Loader2" size={18} className="animate-spin" /> : <><Icon name="Search" size={18} className="mr-2" />Найти главы</>}
            </Button>
          </div>

          {chapters.length > 0 && (
            <div className="animate-fade-up mt-8 space-y-6">
              {/* Book info */}
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/30 p-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                  <Icon name="BookText" size={22} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{bookTitle}</div>
                  <div className="text-sm text-muted-foreground">{chapters.length} бесплатных глав</div>
                </div>
              </div>

              {/* Quick presets */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Быстрый выбор</label>
                <div className="flex flex-wrap gap-2">
                  {[10, 25, 50, 100].filter(n => n < chapters.length).map(n => (
                    <button key={n} onClick={() => { setFromCh(1); setToCh(n); }}
                      className="rounded-lg border border-border bg-secondary/40 px-4 py-2 text-sm font-medium hover:border-primary/60 transition-colors">
                      Первые {n}
                    </button>
                  ))}
                  <button onClick={() => { setFromCh(1); setToCh(chapters.length); }}
                    className="rounded-lg border border-primary/50 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/25 transition-colors">
                    Вся книга
                  </button>
                </div>
              </div>

              {/* Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground">С главы</label>
                  <Input type="number" min={1} max={chapters.length} value={fromCh} onChange={e => setFromCh(Number(e.target.value))} className="mt-2 h-11 rounded-xl border-border bg-secondary/40" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground">По главу</label>
                  <Input type="number" min={1} max={chapters.length} value={toCh} onChange={e => setToCh(Number(e.target.value))} className="mt-2 h-11 rounded-xl border-border bg-secondary/40" />
                </div>
              </div>

              {/* Format */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Формат файла</label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {formats.map(f => (
                    <button key={f.id} onClick={() => setFormat(f.id)}
                      className={`rounded-2xl border p-4 text-left transition-all ${format === f.id ? 'border-primary bg-primary/15 ring-1 ring-primary' : 'border-border bg-secondary/30 hover:border-primary/50'}`}>
                      <Icon name={f.icon} size={22} className={format === f.id ? 'text-primary' : 'text-muted-foreground'} />
                      <div className="mt-3 font-display font-bold">{f.label}</div>
                      <div className="text-xs text-muted-foreground">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Download button + progress */}
              <div>
                <Button onClick={download} disabled={downloading} size="lg"
                  className="glow w-full rounded-xl bg-gradient-to-r from-primary to-accent py-6 text-base font-bold text-white hover:opacity-90">
                  {downloading
                    ? <><Icon name="Loader2" size={20} className="mr-2 animate-spin" />Скачиваю {progressDone} из {progressTotal}...</>
                    : <><Icon name="Download" size={20} className="mr-2" />Скачать главы {from}–{to}</>}
                </Button>

                {downloading && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Прогресс скачивания</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                        style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}
              </div>

              <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Icon name="ShieldCheck" size={14} className="text-accent" />
                Только бесплатные главы
              </p>

              {/* Chapter list with preview */}
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-border bg-secondary/20 p-2">
                {chapters.map((c, i) => {
                  const inRange = i + 1 >= from && i + 1 <= to;
                  return (
                    <div key={c.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm group ${inRange ? 'bg-primary/10' : ''}`}>
                      <span className="w-7 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <button onClick={() => previewSingle(c)} title="Просмотр"
                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1 hover:bg-primary/20 transition-all text-muted-foreground hover:text-white">
                        <Icon name="Eye" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Translate panel — shows after download */}
          {downloadedChapters.length > 0 && (
            <div className="animate-fade-up mt-8 rounded-2xl border border-border bg-secondary/20 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-xl font-bold flex items-center gap-2">
                  <Icon name="Languages" size={20} className="text-accent" /> Перевод на русский
                </h3>
                <div className="text-sm text-muted-foreground">{doneCount}/{downloadedChapters.length} глав</div>
              </div>

              {/* Translate progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Прогресс перевода</span>
                  <span>{translatePct}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-primary transition-all duration-500"
                    style={{ width: `${translatePct}%` }} />
                </div>
              </div>

              <Button onClick={translateAll} disabled={translatingAll || translatePct === 100} size="sm"
                className="mb-4 rounded-xl bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30">
                {translatingAll
                  ? <><Icon name="Loader2" size={14} className="mr-1 animate-spin" />Переводим {translateProgress}/{downloadedChapters.length}</>
                  : translatePct === 100 ? <><Icon name="CheckCircle" size={14} className="mr-1" />Всё переведено</>
                  : <><Icon name="Languages" size={14} className="mr-1" />Перевести все главы</>}
              </Button>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {downloadedChapters.map(ch => {
                  const ts = translateState[ch.id];
                  return (
                    <div key={ch.id} className="rounded-xl border border-border bg-secondary/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{ch.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {ts?.status === 'done' && <Icon name="CheckCircle" size={14} className="text-green-400" />}
                          {ts?.status === 'error' && <Icon name="XCircle" size={14} className="text-red-400" />}
                          {ts?.status === 'loading' && <Icon name="Loader2" size={14} className="animate-spin text-accent" />}
                          <button onClick={() => translateChapter(ch)} disabled={ts?.status === 'loading'}
                            className="text-xs rounded-lg px-2 py-1 bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
                            {ts?.status === 'done' ? 'Ещё раз' : 'Перевести'}
                          </button>
                        </div>
                      </div>
                      {ts?.status === 'done' && ts.text && (
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{ts.text.slice(0, 200)}…</p>
                      )}
                      {ts?.status === 'done' && (
                        <button onClick={() => setPreviewChapter({ ...ch, content: ts.text })}
                          className="mt-1 text-xs text-accent hover:underline">
                          Читать перевод полностью
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* History */}
      <section id="history" className="mx-auto max-w-3xl px-4 pb-24">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold">История загрузок</h2>
            <p className="mt-1 text-muted-foreground">
              {token ? 'Сохранено в аккаунте' : 'Только в этой сессии — войди через Google для сохранения'}
            </p>
          </div>
          {token && (
            <button onClick={loadCloudHistory} className="glass rounded-xl p-2 hover:bg-secondary/50 transition-colors">
              <Icon name={historyLoading ? 'Loader2' : 'RefreshCw'} size={18} className={historyLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {!token && (
          <div className="glass mb-6 rounded-2xl p-5 flex items-center gap-4">
            <Icon name="LogIn" size={24} className="text-accent shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Войди через Google</div>
              <div className="text-sm text-muted-foreground">История будет сохраняться между сессиями</div>
            </div>
            <GoogleSignInButton onToken={login} size="medium" shape="pill" />
          </div>
        )}

        {history.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
            <Icon name="Inbox" size={32} className="mx-auto mb-3" />
            Пока ничего не скачано
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={h.id ?? i} className="glass rounded-2xl overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                    <Icon name="BookOpen" size={22} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{h.book_title}</div>
                    <div className="text-sm text-muted-foreground">
                      {h.chapter_count} глав · {new Date(h.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span className="rounded-lg bg-primary/20 px-3 py-1 text-xs font-semibold text-primary shrink-0">{h.format}</span>
                  <div className="flex gap-2 shrink-0">
                    {h.chapters_data && (
                      <button onClick={() => setExpandedHistory(expandedHistory === i ? null : i)} title="Главы"
                        className="rounded-lg p-2 hover:bg-secondary/50 text-muted-foreground hover:text-white transition-colors">
                        <Icon name={expandedHistory === i ? 'ChevronUp' : 'ChevronDown'} size={16} />
                      </button>
                    )}
                    {h.chapters_data && (
                      <button onClick={() => redownloadHistory(h)} title="Скачать снова"
                        className="rounded-lg p-2 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors">
                        <Icon name="Download" size={16} />
                      </button>
                    )}
                  </div>
                </div>
                {expandedHistory === i && h.chapters_data && (
                  <div className="border-t border-border/50 px-4 pb-4 pt-2 max-h-48 overflow-y-auto space-y-1">
                    {h.chapters_data.map(ch => (
                      <button key={ch.id} onClick={() => setPreviewChapter(ch)}
                        className="w-full text-left rounded-lg px-3 py-1.5 text-sm hover:bg-secondary/40 transition-colors flex items-center gap-2">
                        <Icon name="Eye" size={14} className="text-muted-foreground shrink-0" />
                        <span className="truncate">{ch.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        NovelGrab · Скачивай книги с WebNovel · {new Date().getFullYear()}
      </footer>

      {/* Chapter Preview Modal */}
      {previewChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && setPreviewChapter(null)}>
          <div className="glass w-full max-w-2xl rounded-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/50">
              <h3 className="font-display font-bold text-lg truncate pr-4">{previewChapter.name}</h3>
              <button onClick={() => setPreviewChapter(null)} className="rounded-xl p-2 hover:bg-secondary/50 transition-colors shrink-0">
                <Icon name="X" size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 flex-1">
              {previewLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Icon name="Loader2" size={32} className="animate-spin text-primary" />
                </div>
              ) : previewChapter.content ? (
                <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                  {previewChapter.content.split('\n\n').map((p, i) => <p key={i} className="mb-3 text-foreground/90">{p}</p>)}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground">Содержимое не загружено</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function extractBookId(url: string): string {
  const m = url.match(/_(\d{10,})(?:[^0-9].*)?$/);
  if (m) return m[1];
  const all = url.match(/\d{12,}/g);
  return all ? all[all.length - 1] : '';
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function buildFile(title: string, list: DownloadedChapter[], format: string): Promise<{ blob: Blob; ext: string }> {
  if (format === 'html') {
    const body = list.map(c => `<h2>${esc(c.name)}</h2>${c.content.split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}`).join('<hr/>');
    return { blob: new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>${body}</body></html>`], { type: 'text/html' }), ext: 'html' };
  }
  if (format === 'epub') {
    return { blob: await buildEpub(title, list), ext: 'epub' };
  }
  return { blob: new Blob([`${title}\n\n` + list.map(c => `${c.name}\n\n${c.content}`).join('\n\n\n')], { type: 'text/plain' }), ext: 'txt' };
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function buildEpub(title: string, chapters: DownloadedChapter[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.folder('META-INF')!.file('container.xml',
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const oebps = zip.folder('OEBPS')!;
  const manifest: string[] = [], spine: string[] = [];
  chapters.forEach((ch, i) => {
    const id = `c${i + 1}`, fname = `${id}.xhtml`;
    const paras = ch.content.split('\n\n').filter(Boolean).map(p => `<p>${esc(p.trim())}</p>`).join('');
    oebps.file(fname, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>${esc(ch.name)}</title></head><body><h2>${esc(ch.name)}</h2>${paras}</body></html>`);
    manifest.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
  });
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  oebps.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><dc:identifier id="uid">${uid}</dc:identifier></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest.join('')}</manifest><spine toc="ncx">${spine.join('')}</spine></package>`);
  const nav = chapters.map((ch, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(ch.name)}</text></navLabel><content src="c${i + 1}.xhtml"/></navPoint>`).join('');
  oebps.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${nav}</navMap></ncx>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}