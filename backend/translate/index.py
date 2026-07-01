import json
import logging
import time
from typing import Any, Dict, List
from urllib.parse import quote

import requests

log = logging.getLogger()
log.setLevel(logging.INFO)

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
}

CHUNK_SIZE = 4500
TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'


# ─── Helpers ──────────────────────────────────────────────────────────────────

def resp(status: int, body: dict) -> dict:
    return {
        'statusCode': status,
        'headers': CORS,
        'body': json.dumps(body, ensure_ascii=False),
    }


def translate_text(text: str) -> str:
    """
    Translate text from English to Russian using the free Google Translate API.
    Splits text into chunks of CHUNK_SIZE characters to stay within the API limit.
    """
    if not text or not text.strip():
        return text

    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        # Try to break at a paragraph boundary to avoid cutting sentences
        if end < len(text):
            boundary = text.rfind('\n\n', start, end)
            if boundary != -1 and boundary > start:
                end = boundary + 2  # include the newlines
            else:
                sentence_end = text.rfind('. ', start, end)
                if sentence_end != -1 and sentence_end > start:
                    end = sentence_end + 2
        chunks.append(text[start:end])
        start = end

    translated_parts = []
    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            translated_parts.append(chunk)
            continue
        try:
            encoded = quote(chunk)
            url = (
                f'{TRANSLATE_URL}'
                f'?client=gtx&sl=en&tl=ru&dt=t&q={encoded}'
            )
            r = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                              'AppleWebKit/537.36 (KHTML, like Gecko) '
                              'Chrome/124.0.0.0 Safari/537.36',
            })
            if r.status_code != 200:
                log.warning(f'Translate chunk {i} status={r.status_code}')
                translated_parts.append(chunk)
                continue

            data = r.json()
            # Response structure: [[["translated", "original", ...], ...], ...]
            # Collect all translated segments from the first array
            segments = []
            if data and isinstance(data[0], list):
                for item in data[0]:
                    if item and isinstance(item, list) and item[0]:
                        segments.append(str(item[0]))
            translated_chunk = ''.join(segments)
            translated_parts.append(translated_chunk if translated_chunk else chunk)

        except Exception as e:
            log.error(f'Translate chunk {i} error: {e}')
            translated_parts.append(chunk)

    return ''.join(translated_parts)


# ─── Actions ──────────────────────────────────────────────────────────────────

def action_translate_chapter(body: dict) -> dict:
    text = str(body.get('text') or '')
    chapter_name = str(body.get('chapter_name') or '')

    if not text.strip():
        return resp(400, {'error': 'text is required'})

    log.info(f'translate_chapter len={len(text)} chapter={chapter_name!r}')

    try:
        translated = translate_text(text)
    except Exception as e:
        log.error(f'translate_chapter error: {e}')
        return resp(502, {'error': 'Translation failed', 'detail': str(e)})

    return resp(200, {'translated': translated, 'chapter_name': chapter_name})


def action_translate_batch(body: dict) -> dict:
    chapters: List[Dict[str, Any]] = body.get('chapters') or []

    if not chapters:
        return resp(400, {'error': 'chapters array is required'})

    log.info(f'translate_batch count={len(chapters)}')

    results = []
    for chapter in chapters:
        cid = chapter.get('id', '')
        name = str(chapter.get('name') or '')
        content = str(chapter.get('content') or '')

        if not content.strip():
            results.append({
                'id': cid,
                'name': name,
                'translated': '',
                'status': 'error',
            })
            continue

        try:
            translated = translate_text(content)
            results.append({
                'id': cid,
                'name': name,
                'translated': translated,
                'status': 'done',
            })
            log.info(f'chapter {cid!r} translated ok, len={len(translated)}')
        except Exception as e:
            log.error(f'chapter {cid!r} translate error: {e}')
            results.append({
                'id': cid,
                'name': name,
                'translated': '',
                'status': 'error',
            })

        # Pause between requests to avoid rate limiting
        time.sleep(0.5)

    return resp(200, {'chapters': results})


# ─── Entry Point ──────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    action = (body.get('action') or '').strip()
    log.info(f'translate action={action}')

    if action == 'translate_chapter':
        return action_translate_chapter(body)
    if action == 'translate_batch':
        return action_translate_batch(body)

    return resp(400, {'error': f'Unknown action: {action}'})
