import { useState } from 'react';
import JSZip from 'jszip';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

const API = 'https://functions.poehali.dev/a4df85d2-e037-42d4-9d2f-8ae54e96cfaa';

interface Chapter {
  id: string;
  index: number;
  name: string;
  free: boolean;
}

interface HistoryItem {
  title: string;
  chapters: number;
  format: string;
  date: string;
}

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

const Index = () => {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('txt');
  const [active, setActive] = useState('home');

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [fromCh, setFromCh] = useState(1);
  const [toCh, setToCh] = useState(1);
  const [progress, setProgress] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const nav = [
    { id: 'home', label: 'Главная' },
    { id: 'download', label: 'Загрузка' },
    { id: 'history', label: 'История' },
  ];

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadChapters = async () => {
    if (!url.trim()) {
      toast({ title: 'Вставь ссылку на книгу', variant: 'destructive' });
      return;
    }
    setLoading(true);
    setChapters([]);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chapters', url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Не удалось загрузить главы', description: data.error, variant: 'destructive' });
        return;
      }
      setBookTitle(data.title);
      setChapters(data.chapters);
      setFromCh(1);
      setToCh(data.chapters.length);
      toast({ title: `Найдено ${data.chapters.length} бесплатных глав`, description: data.title });
    } catch {
      toast({ title: 'Ошибка сети', description: 'Попробуй ещё раз', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const buildFile = async (list: { name: string; content: string }[]) => {
    if (format === 'html') {
      const body = list
        .map((c) => `<h2>${escapeHtml(c.name)}</h2>${c.content.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`)
        .join('\n<hr/>\n');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(bookTitle)}</title></head><body><h1>${escapeHtml(bookTitle)}</h1>${body}</body></html>`;
      return { blob: new Blob([html], { type: 'text/html' }), ext: 'html' };
    }
    if (format === 'epub') {
      const blob = await buildEpub(bookTitle, list);
      return { blob, ext: 'epub' };
    }
    const txt = `${bookTitle}\n\n` + list.map((c) => `${c.name}\n\n${c.content}`).join('\n\n\n');
    return { blob: new Blob([txt], { type: 'text/plain' }), ext: 'txt' };
  };

  const download = async () => {
    if (!chapters.length) return;
    const from = Math.max(1, Math.min(fromCh, chapters.length));
    const to = Math.max(from, Math.min(toCh, chapters.length));
    const selected = chapters.slice(from - 1, to);
    setDownloading(true);
    setProgress(`Скачиваю ${selected.length} глав...`);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', url: url.trim(), chapterIds: selected.map((c) => c.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Ошибка скачивания', description: data.error, variant: 'destructive' });
        return;
      }
      const { blob, ext } = await buildFile(data.chapters);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${bookTitle.replace(/[^\w\d]+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);

      setHistory((h) => [
        { title: bookTitle, chapters: selected.length, format: format.toUpperCase(), date: new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
        ...h,
      ]);
      toast({ title: 'Готово!', description: `Скачано ${data.chapters.length} глав в формате ${ext.toUpperCase()}` });
    } catch {
      toast({ title: 'Ошибка сети при скачивании', variant: 'destructive' });
    } finally {
      setDownloading(false);
      setProgress('');
    }
  };

  const setPreset = (n: number) => {
    setFromCh(1);
    setToCh(Math.min(n, chapters.length));
  };

  return (
    <div className="min-h-screen aurora relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -right-32 h-[30rem] w-[30rem] rounded-full bg-primary/20 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute top-1/2 -left-40 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-3xl animate-float-slow" style={{ animationDelay: '2s' }} />

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

      <section id="home" className="relative mx-auto max-w-5xl px-4 pb-20 pt-24 text-center">
        <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary">
          <Icon name="Zap" size={14} />
          Бесплатные главы WebNovel в один клик
        </div>
        <h1 className="animate-fade-up mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl" style={{ animationDelay: '0.1s' }}>
          Читай книги <span className="text-gradient">где угодно</span>
        </h1>
        <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg text-muted-foreground" style={{ animationDelay: '0.2s' }}>
          Вставь ссылку на книгу с webnovel.com, выбери нужные главы и скачай их
          в TXT, EPUB или HTML. Только бесплатные главы.
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
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://m.webnovel.com/book/..."
                className="h-12 rounded-xl border-border bg-secondary/40 pl-11 text-base"
              />
            </div>
            <Button onClick={loadChapters} disabled={loading} size="lg" className="h-12 rounded-xl bg-primary font-semibold hover:bg-primary/90">
              {loading ? <Icon name="Loader2" size={18} className="animate-spin" /> : <Icon name="Search" size={18} className="mr-2" />}
              {loading ? '' : 'Найти главы'}
            </Button>
          </div>

          {chapters.length > 0 && (
            <div className="animate-fade-up mt-8">
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-secondary/30 p-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                  <Icon name="BookText" size={22} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{bookTitle}</div>
                  <div className="text-sm text-muted-foreground">{chapters.length} бесплатных глав доступно</div>
                </div>
              </div>

              <label className="block text-sm font-medium text-muted-foreground">Быстрый выбор</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {[10, 25, 50, 100].filter((n) => n < chapters.length).map((n) => (
                  <button key={n} onClick={() => setPreset(n)} className="rounded-lg border border-border bg-secondary/40 px-4 py-2 text-sm font-medium transition-colors hover:border-primary/60">
                    Первые {n}
                  </button>
                ))}
                <button onClick={() => setPreset(chapters.length)} className="rounded-lg border border-primary/50 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25">
                  Вся книга
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground">С главы</label>
                  <Input type="number" min={1} max={chapters.length} value={fromCh} onChange={(e) => setFromCh(Number(e.target.value))} className="mt-2 h-11 rounded-xl border-border bg-secondary/40" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground">По главу</label>
                  <Input type="number" min={1} max={chapters.length} value={toCh} onChange={(e) => setToCh(Number(e.target.value))} className="mt-2 h-11 rounded-xl border-border bg-secondary/40" />
                </div>
              </div>

              <label className="mt-6 block text-sm font-medium text-muted-foreground">Формат файла</label>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {formats.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      format === f.id ? 'border-primary bg-primary/15 ring-1 ring-primary' : 'border-border bg-secondary/30 hover:border-primary/50'
                    }`}
                  >
                    <Icon name={f.icon} size={22} className={format === f.id ? 'text-primary' : 'text-muted-foreground'} />
                    <div className="mt-3 font-display font-bold">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.desc}</div>
                  </button>
                ))}
              </div>

              <Button onClick={download} disabled={downloading} size="lg" className="glow mt-8 w-full rounded-xl bg-gradient-to-r from-primary to-accent py-6 text-base font-bold text-white hover:opacity-90">
                {downloading ? <Icon name="Loader2" size={20} className="mr-2 animate-spin" /> : <Icon name="Download" size={20} className="mr-2" />}
                {downloading ? progress : `Скачать главы ${Math.min(fromCh, toCh)}–${Math.max(fromCh, toCh)}`}
              </Button>
              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Icon name="ShieldCheck" size={14} className="text-accent" />
                Скачиваются только бесплатно доступные главы
              </p>

              <div className="mt-6 max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border bg-secondary/20 p-2">
                {chapters.map((c, i) => {
                  const inRange = i + 1 >= Math.min(fromCh, toCh) && i + 1 <= Math.max(fromCh, toCh);
                  return (
                    <div key={c.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${inRange ? 'bg-primary/10' : ''}`}>
                      <span className="w-8 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                      <span className="truncate">{c.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="history" className="mx-auto max-w-3xl px-4 pb-24">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold">История загрузок</h2>
            <p className="mt-1 text-muted-foreground">Скачанные в этой сессии книги</p>
          </div>
          <Icon name="History" size={28} className="text-primary" />
        </div>
        {history.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
            <Icon name="Inbox" size={32} className="mx-auto mb-3 text-muted-foreground" />
            Пока ничего не скачано
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="glass flex items-center gap-4 rounded-2xl p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/20">
                  <Icon name="BookOpen" size={22} className="text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{h.title}</div>
                  <div className="text-sm text-muted-foreground">{h.chapters} глав · {h.date}</div>
                </div>
                <span className="rounded-lg bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">{h.format}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        NovelGrab · Скачивай книги с WebNovel · {new Date().getFullYear()}
      </footer>
    </div>
  );
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildEpub(title: string, chapters: { name: string; content: string }[]): Promise<Blob> {
  const zip = new JSZip();

  // mimetype — первым, без сжатия
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.folder('META-INF')!.file('container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS')!;

  // Каждая глава — отдельный XHTML файл
  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  chapters.forEach((ch, i) => {
    const id = `chapter_${i + 1}`;
    const fname = `${id}.xhtml`;
    const paras = ch.content
      .split('\n\n')
      .filter(Boolean)
      .map((p) => `    <p>${escapeHtml(p.trim())}</p>`)
      .join('\n');

    oebps.file(fname,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeHtml(ch.name)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h2>${escapeHtml(ch.name)}</h2>
${paras}
</body>
</html>`);

    manifestItems.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
  });

  // CSS
  oebps.file('style.css',
    `body { font-family: serif; font-size: 1em; line-height: 1.6; margin: 1em 2em; }
h2 { font-size: 1.3em; margin-top: 2em; margin-bottom: 0.5em; }
p { margin: 0.5em 0; text-indent: 1.5em; }`);

  // content.opf — основной манифест
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  oebps.file('content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">${uid}</dc:identifier>
  </metadata>
  <manifest>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`);

  // toc.ncx — оглавление
  const navPoints = chapters.map((ch, i) => `
    <navPoint id="nav_${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeHtml(ch.name)}</text></navLabel>
      <content src="chapter_${i + 1}.xhtml"/>
    </navPoint>`).join('');

  oebps.file('toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>`);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

export default Index;