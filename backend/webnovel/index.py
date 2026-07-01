import json
import re
import time
import logging
from typing import Any, Dict, List, Tuple

import requests
from bs4 import BeautifulSoup

log = logging.getLogger()
log.setLevel(logging.INFO)

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
}


def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    '''Парсит WebNovel: список бесплатных глав и текст выбранных глав по ссылке на книгу.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    action = body.get('action', 'chapters')
    url = (body.get('url') or '').strip()
    book_id = extract_book_id(url)
    log.info(f'action={action} book_id={book_id}')

    if not book_id:
        return resp(400, {'error': 'Не удалось распознать ссылку. Формат: https://m.webnovel.com/book/название_123456789'})

    if action == 'chapters':
        return get_chapter_list(book_id)
    if action == 'download':
        return download_chapters(book_id, body.get('chapterIds') or [])

    return resp(400, {'error': 'Неизвестное действие'})


def extract_book_id(url: str) -> str:
    # Убираем пробелы и мусор, ищем последний длинный числовой ID в конце slug
    url = url.strip()
    # _35939753408038705 — ищем последнее вхождение подчёркивания + цифры
    m = re.search(r'_(\d{10,})(?:[^0-9].*)?$', url)
    if m:
        return m.group(1)
    # Запасной: любая последовательность из 12+ цифр в URL
    matches = re.findall(r'\d{12,}', url)
    return matches[-1] if matches else ''


def make_session(book_id: str) -> Tuple[requests.Session, str]:
    '''Создаём сессию и получаем CSRF-токен через посещение страницы книги.'''
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    s = requests.Session()
    s.headers.update(HEADERS)
    s.verify = False
    csrf = ''

    # Посещаем мобильную страницу книги — получаем cookies
    try:
        r = s.get(f'https://m.webnovel.com/book/{book_id}', timeout=20, allow_redirects=True, verify=False)
        log.info(f'warmup status={r.status_code} cookies={list(s.cookies.keys())}')
        # Ищем CSRF в cookies
        for name in ['_csrfToken', 'csrfToken', 'csrf_token', 'csrf']:
            if name in s.cookies:
                csrf = s.cookies[name]
                log.info(f'csrf from cookie [{name}]: {csrf[:12]}')
                break
        # Ищем CSRF в HTML
        if not csrf:
            m = re.search(r'"_csrfToken"\s*:\s*"([a-zA-Z0-9_\-]{10,})"', r.text)
            if not m:
                m = re.search(r'csrfToken["\']?\s*[=:]\s*["\']([a-zA-Z0-9_\-]{10,})', r.text)
            if m:
                csrf = m.group(1)
                log.info(f'csrf from html: {csrf[:12]}')
    except Exception as e:
        log.info(f'warmup error: {e}')

    return s, csrf


# ─── Список глав ─────────────────────────────────────────────────────────────

def get_chapter_list(book_id: str) -> Dict[str, Any]:
    s, csrf = make_session(book_id)
    title = 'Книга WebNovel'
    chapters: List[Dict] = []

    # 1. JSON API с CSRF токеном
    if not chapters:
        title, chapters = try_api(s, book_id, csrf)

    # 2. Парсим __INITIAL_STATE__ / window.__DATA__ из HTML скриптов
    if not chapters:
        title, chapters = try_script_json(s, book_id, title)

    # 3. Regex по объектам глав прямо в тексте скрипта
    if not chapters:
        title, chapters = try_regex_chapters(s, book_id, title)

    log.info(f'total={len(chapters)} free={sum(1 for c in chapters if c.get("free"))}')

    free = [c for c in chapters if c.get('free', True)]
    if not free:
        return resp(502, {
            'error': 'Не удалось получить список глав. '
                     'WebNovel блокирует запрос или все главы платные. '
                     'Подожди минуту и попробуй ещё раз.'
        })

    return resp(200, {'title': title, 'total': len(chapters), 'chapters': free})


def try_api(s: requests.Session, book_id: str, csrf: str) -> Tuple[str, List[Dict]]:
    title = 'Книга WebNovel'
    token = csrf or ''
    endpoints = [
        f'https://www.webnovel.com/apiajax/chapter/GetChapterList?_csrfToken={token}&bookId={book_id}',
        f'https://www.webnovel.com/go/pcm/chapter/get-chapter-list?bookId={book_id}&_csrfToken={token}',
    ]
    for url in endpoints:
        try:
            r = s.get(url, timeout=20, verify=False, headers={
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': f'https://www.webnovel.com/book/{book_id}',
            })
            log.info(f'API {url[-60:]} => {r.status_code} len={len(r.text)} preview={r.text[:300]}')
            if r.status_code != 200:
                continue
            data = r.json()
            code = data.get('code') or data.get('Code')
            log.info(f'API code={code} msg={data.get("msg")}')
            book_info = (data.get('data') or {}).get('bookInfo') or {}
            title = book_info.get('bookName') or title
            chapters = []
            for vol in (data.get('data') or {}).get('volumeItems') or []:
                for ch in vol.get('chapterItems') or []:
                    chapters.append(parse_chapter(ch, len(chapters)))
            if chapters:
                log.info(f'API success: {len(chapters)} chapters')
                return title, chapters
        except Exception as e:
            log.info(f'API error: {e}')
    return title, []


def try_script_json(s: requests.Session, book_id: str, title: str) -> Tuple[str, List[Dict]]:
    '''Ищем данные в <script> тегах — WebNovel часто кладёт __INITIAL_STATE__ в HTML.'''
    for page_url in [
        f'https://www.webnovel.com/book/{book_id}',
        f'https://m.webnovel.com/book/{book_id}',
    ]:
        try:
            r = s.get(page_url, timeout=20, verify=False)
            log.info(f'Script page {page_url} => {r.status_code} len={len(r.text)}')
            soup = BeautifulSoup(r.text, 'html.parser')

            h = soup.find('h1') or soup.find('h2')
            if h:
                title = h.get_text(strip=True) or title

            for script in soup.find_all('script'):
                t = script.string or ''
                if len(t) < 50:
                    continue

                # volumeItems или chapterItems
                for pat in [
                    r'"volumeItems"\s*:\s*(\[(?:[^[\]]|\[(?:[^[\]]|\[[^\]]*\])*\])*\])',
                    r'"chapterItems"\s*:\s*(\[(?:[^[\]]|\[(?:[^[\]]|\[[^\]]*\])*\])*\])',
                ]:
                    m = re.search(pat, t)
                    if m:
                        chapters = parse_items_json(m.group(1))
                        if chapters:
                            log.info(f'Script JSON ({pat[:30]}) => {len(chapters)} chapters')
                            return title, chapters

        except Exception as e:
            log.info(f'Script JSON error {page_url}: {e}')
    return title, []


def try_regex_chapters(s: requests.Session, book_id: str, title: str) -> Tuple[str, List[Dict]]:
    '''Regex-поиск объектов глав в сыром тексте страницы.'''
    for page_url in [
        f'https://www.webnovel.com/book/{book_id}',
        f'https://m.webnovel.com/book/{book_id}',
    ]:
        try:
            r = s.get(page_url, timeout=20, verify=False)
            text = r.text
            log.info(f'Regex page {page_url} len={len(text)}')

            found = re.findall(
                r'"chapterId"\s*:\s*"?(\d+)"?'
                r'(?:(?!"chapterId").){0,300}'
                r'"chapterName"\s*:\s*"([^"]{1,200})"'
                r'(?:(?!"chapterId").){0,200}'
                r'"isVip"\s*:\s*(\d)',
                text, re.DOTALL
            )
            log.info(f'Regex found {len(found)} raw entries')
            if found:
                seen = set()
                chapters = []
                for cid, name, vip in found:
                    if cid not in seen:
                        seen.add(cid)
                        chapters.append({'id': cid, 'index': len(chapters)+1, 'name': name, 'free': vip == '0'})
                return title, chapters
        except Exception as e:
            log.info(f'Regex error {page_url}: {e}')
    return title, []


def parse_items_json(raw: str) -> List[Dict]:
    try:
        items = json.loads(raw)
        chapters = []
        for item in items:
            if not isinstance(item, dict):
                continue
            # volumeItems содержит chapterItems внутри
            sub = item.get('chapterItems')
            if sub:
                for ch in sub:
                    chapters.append(parse_chapter(ch, len(chapters)))
            elif 'chapterId' in item or 'chapterName' in item:
                chapters.append(parse_chapter(item, len(chapters)))
        return chapters
    except Exception as e:
        log.info(f'parse_items_json error: {e}')
        return []


def parse_chapter(ch: dict, idx: int) -> Dict:
    is_vip = ch.get('isVip', 0)
    return {
        'id': str(ch.get('chapterId') or ch.get('id') or ''),
        'index': idx + 1,
        'name': ch.get('chapterName') or ch.get('name') or f'Chapter {idx + 1}',
        'free': int(is_vip) == 0,
    }


# ─── Скачивание текста глав ──────────────────────────────────────────────────

def download_chapters(book_id: str, chapter_ids: List[str]) -> Dict[str, Any]:
    s, csrf = make_session(book_id)
    result = []
    for cid in chapter_ids[:200]:
        name, text = fetch_chapter_text(s, book_id, str(cid), csrf)
        result.append({'id': cid, 'name': name, 'content': text})
        time.sleep(0.4)
    return resp(200, {'chapters': result})


def fetch_chapter_text(s: requests.Session, book_id: str, cid: str, csrf: str = '') -> Tuple[str, str]:
    name = f'Chapter {cid}'
    token = csrf or ''

    # Метод 1: JSON API
    for api_url in [
        f'https://www.webnovel.com/apiajax/chapter/GetContent?_csrfToken={token}&bookId={book_id}&chapterId={cid}',
        f'https://www.webnovel.com/go/pcm/chapter/get-chapter-content?bookId={book_id}&chapterId={cid}&_csrfToken={token}',
    ]:
        try:
            r = s.get(api_url, timeout=20, verify=False, headers={
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': f'https://www.webnovel.com/book/{book_id}/{cid}',
            })
            if r.status_code != 200:
                continue
            data = r.json()
            info = (data.get('data') or {}).get('chapterInfo') or {}
            name = info.get('chapterName') or name
            contents = info.get('contents') or []
            if contents:
                paras = [c.get('content', '') for c in contents if c.get('content')]
                text = clean('\n\n'.join(paras))
                if len(text) > 50:
                    return name, text
            raw_html = info.get('content') or ''
            if raw_html:
                return name, clean(BeautifulSoup(raw_html, 'html.parser').get_text('\n\n'))
        except Exception as e:
            log.info(f'Chapter API error cid={cid}: {e}')

    # Метод 2: HTML страница главы
    try:
        for ch_url in [
            f'https://www.webnovel.com/book/{book_id}/{cid}',
            f'https://m.webnovel.com/book/{book_id}/chapter/{cid}',
        ]:
            r = s.get(ch_url, timeout=20, verify=False)
            soup = BeautifulSoup(r.text, 'html.parser')

            for sel in ['h1', 'h2', '.cha-tit', '.chapter-title']:
                el = soup.select_one(sel)
                if el and el.get_text(strip=True):
                    name = el.get_text(strip=True)
                    break

            # JSON в скрипте
            for script in soup.find_all('script'):
                t = script.string or ''
                m = re.search(r'"contents"\s*:\s*(\[.+?\])', t, re.DOTALL)
                if m:
                    try:
                        items = json.loads(m.group(1))
                        paras = [i.get('content', '') for i in items if i.get('content')]
                        result = clean('\n\n'.join(paras))
                        if len(result) > 50:
                            return name, result
                    except Exception:
                        pass

            # div с параграфами
            for sel in ['div.cha-words', 'div.chapter-content', 'div[class*="content"]', 'article']:
                el = soup.select_one(sel)
                if el:
                    for bad in el.find_all(['script', 'style', 'nav', 'button']):
                        bad.decompose()
                    paras = [p.get_text(strip=True) for p in el.find_all('p') if p.get_text(strip=True)]
                    if paras:
                        return name, clean('\n\n'.join(paras))

    except Exception as e:
        log.info(f'Chapter HTML error cid={cid}: {e}')

    return name, '[Не удалось загрузить — глава может быть платной]'


def clean(text: str) -> str:
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def resp(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': CORS, 'body': json.dumps(payload, ensure_ascii=False)}