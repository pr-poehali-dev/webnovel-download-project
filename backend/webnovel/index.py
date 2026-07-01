import json
import re
import time
from typing import Any, Dict, List

import requests
from bs4 import BeautifulSoup

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
}

UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
      'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1')


def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    '''Парсит WebNovel: список бесплатных глав книги и текст выбранных глав по ссылке.'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    action = body.get('action', 'chapters')
    url = (body.get('url') or '').strip()
    book_id = extract_book_id(url)

    if not book_id:
        return resp(400, {'error': 'Не удалось распознать ссылку на книгу WebNovel'})

    if action == 'chapters':
        return get_chapter_list(book_id)
    if action == 'download':
        ids = body.get('chapterIds') or []
        return download_chapters(book_id, ids)

    return resp(400, {'error': 'Неизвестное действие'})


def extract_book_id(url: str) -> str:
    m = re.search(r'_(\d{6,})', url)
    if m:
        return m.group(1)
    m = re.search(r'/book/[^/]*?(\d{10,})', url)
    return m.group(1) if m else ''


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
    return s


def get_chapter_list(book_id: str) -> Dict[str, Any]:
    s = new_session()
    api = f'https://www.webnovel.com/apiajax/chapter/GetChapterList?_csrfToken=&bookId={book_id}'
    try:
        r = s.get(api, timeout=25)
        data = r.json()
    except Exception:
        data = {}

    chapters: List[Dict[str, Any]] = []
    title = 'WebNovel Book'
    book_info = (data.get('data') or {}).get('bookInfo') or {}
    title = book_info.get('bookName') or title

    volumes = (data.get('data') or {}).get('volumeItems') or []
    for vol in volumes:
        for ch in vol.get('chapterItems') or []:
            is_free = str(ch.get('isVip', 0)) in ('0', 'false', 'False')
            chapters.append({
                'id': str(ch.get('chapterId')),
                'index': ch.get('chapterIndex') or len(chapters) + 1,
                'name': ch.get('chapterName') or f'Chapter {len(chapters) + 1}',
                'free': is_free,
            })

    free = [c for c in chapters if c['free']]
    if not free:
        return resp(502, {'error': 'Не удалось получить бесплатные главы. Возможно, сайт защищён или все главы платные.'})

    return resp(200, {'title': title, 'total': len(chapters), 'chapters': free})


def download_chapters(book_id: str, chapter_ids: List[str]) -> Dict[str, Any]:
    s = new_session()
    result = []
    for cid in chapter_ids[:200]:
        text, name = fetch_chapter(s, book_id, str(cid))
        result.append({'id': str(cid), 'name': name, 'content': text})
        time.sleep(0.2)
    return resp(200, {'chapters': result})


def fetch_chapter(s: requests.Session, book_id: str, cid: str):
    api = (f'https://www.webnovel.com/apiajax/chapter/GetContent'
           f'?_csrfToken=&bookId={book_id}&chapterId={cid}')
    name = f'Chapter {cid}'
    try:
        r = s.get(api, timeout=25)
        data = r.json()
        info = (data.get('data') or {}).get('chapterInfo') or {}
        name = info.get('chapterName') or name
        contents = info.get('contents') or []
        if contents:
            paras = [c.get('content', '') for c in contents]
            return clean('\n\n'.join(paras)), name
        raw = info.get('content') or ''
        if raw:
            return clean(BeautifulSoup(raw, 'html.parser').get_text('\n\n')), name
    except Exception:
        pass
    return '[Не удалось загрузить содержимое главы]', name


def clean(text: str) -> str:
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def resp(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': CORS, 'body': json.dumps(payload, ensure_ascii=False)}
