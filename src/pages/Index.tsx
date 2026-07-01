import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formats = [
  { id: 'pdf', label: 'PDF', icon: 'FileText', desc: 'Для печати и чтения' },
  { id: 'epub', label: 'EPUB', icon: 'BookOpen', desc: 'Для e-ink ридеров' },
  { id: 'mobi', label: 'MOBI', icon: 'Tablet', desc: 'Для Kindle' },
];

const steps = [
  { icon: 'Link2', title: 'Вставь ссылку', text: 'Скопируй URL книги с m.webnovel.com' },
  { icon: 'Sparkles', title: 'Выбери формат', text: 'PDF, EPUB или MOBI — всё сразу' },
  { icon: 'Download', title: 'Скачай книгу', text: 'Только бесплатные главы, без ограничений' },
];

const history = [
  { title: 'Uchiha Orphan: So What If I\'m Ruthless', chapters: 148, format: 'EPUB', date: 'Сегодня, 14:22' },
  { title: 'Reincarnation of the Strongest Sword God', chapters: 92, format: 'PDF', date: 'Вчера, 20:10' },
  { title: 'Lord of the Mysteries', chapters: 210, format: 'MOBI', date: '28 июня' },
];

const Index = () => {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('epub');
  const [active, setActive] = useState('home');

  const nav = [
    { id: 'home', label: 'Главная' },
    { id: 'download', label: 'Загрузка' },
    { id: 'history', label: 'История' },
  ];

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => scrollTo(n.id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active === n.id ? 'bg-primary/20 text-white' : 'text-muted-foreground hover:text-white'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
          <Button onClick={() => scrollTo('download')} className="rounded-xl bg-primary font-semibold hover:bg-primary/90">
            Скачать книгу
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section id="home" className="relative mx-auto max-w-5xl px-4 pb-20 pt-24 text-center">
        <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary">
          <Icon name="Zap" size={14} />
          Бесплатные главы WebNovel в один клик
        </div>
        <h1 className="animate-fade-up mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl" style={{ animationDelay: '0.1s' }}>
          Читай книги <span className="text-gradient">где угодно</span>
        </h1>
        <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg text-muted-foreground" style={{ animationDelay: '0.2s' }}>
          Вставь ссылку на книгу с webnovel.com и скачай все бесплатные главы
          в PDF, EPUB или MOBI. Автоматическая конвертация — за секунды.
        </p>
        <div className="animate-fade-up mt-10 flex flex-wrap items-center justify-center gap-4" style={{ animationDelay: '0.3s' }}>
          <Button onClick={() => scrollTo('download')} size="lg" className="glow rounded-xl bg-primary px-8 text-base font-semibold hover:bg-primary/90">
            <Icon name="Download" size={18} className="mr-2" />
            Начать загрузку
          </Button>
          <Button onClick={() => scrollTo('history')} size="lg" variant="outline" className="rounded-xl border-border bg-secondary/50 px-8 text-base hover:bg-secondary">
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
          <p className="mt-2 text-muted-foreground">Вставь ссылку на книгу и выбери формат для конвертации.</p>

          <label className="mt-8 block text-sm font-medium text-muted-foreground">Ссылка на книгу</label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="Link2" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://m.webnovel.com/book/..."
                className="h-12 rounded-xl border-border bg-secondary/40 pl-11 text-base"
              />
            </div>
          </div>

          <label className="mt-6 block text-sm font-medium text-muted-foreground">Формат файла</label>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {formats.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  format === f.id
                    ? 'border-primary bg-primary/15 ring-1 ring-primary'
                    : 'border-border bg-secondary/30 hover:border-primary/50'
                }`}
              >
                <Icon name={f.icon} size={22} className={format === f.id ? 'text-primary' : 'text-muted-foreground'} />
                <div className="mt-3 font-display font-bold">{f.label}</div>
                <div className="text-xs text-muted-foreground">{f.desc}</div>
              </button>
            ))}
          </div>

          <Button size="lg" className="glow mt-8 h-13 w-full rounded-xl bg-gradient-to-r from-primary to-accent py-6 text-base font-bold text-white hover:opacity-90">
            <Icon name="Download" size={20} className="mr-2" />
            Скачать бесплатные главы
          </Button>
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Icon name="ShieldCheck" size={14} className="text-accent" />
            Скачиваются только бесплатно доступные главы
          </p>
        </div>
      </section>

      {/* History */}
      <section id="history" className="mx-auto max-w-3xl px-4 pb-24">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold">История загрузок</h2>
            <p className="mt-1 text-muted-foreground">Последние скачанные книги</p>
          </div>
          <Icon name="History" size={28} className="text-primary" />
        </div>
        <div className="space-y-3">
          {history.map((h) => (
            <div key={h.title} className="glass flex items-center gap-4 rounded-2xl p-4 transition-transform hover:-translate-y-0.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                <Icon name="BookOpen" size={22} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{h.title}</div>
                <div className="text-sm text-muted-foreground">{h.chapters} глав · {h.date}</div>
              </div>
              <span className="rounded-lg bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">{h.format}</span>
              <Button size="icon" variant="ghost" className="rounded-lg text-muted-foreground hover:text-white">
                <Icon name="Download" size={18} />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        NovelGrab · Скачивай книги с WebNovel · {new Date().getFullYear()}
      </footer>
    </div>
  );
};

export default Index;
