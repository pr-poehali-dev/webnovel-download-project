import json
import logging
import os
import secrets
from datetime import datetime

import psycopg2
import requests

log = logging.getLogger()
log.setLevel(logging.INFO)

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Content-Type': 'application/json',
}

DATABASE_URL = os.environ.get('DATABASE_URL', '')
SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 't_p74407000_webnovel_download_pr')
ADMIN_EMAIL = 'latikant82@gmail.com'


# ─── Helpers ──────────────────────────────────────────────────────────────────

def resp(status: int, body: dict) -> dict:
    return {
        'statusCode': status,
        'headers': CORS,
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def esc(value) -> str:
    """Escape a string value for safe SQL interpolation (Simple Query Protocol)."""
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def ensure_tables(cur):
    """Create tables if they don't exist."""
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.users (
            id          SERIAL PRIMARY KEY,
            google_id   TEXT UNIQUE NOT NULL,
            email       TEXT UNIQUE NOT NULL,
            name        TEXT,
            avatar      TEXT,
            is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.sessions (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES {SCHEMA}.users(id) ON DELETE CASCADE,
            token      TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.downloads (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES {SCHEMA}.users(id) ON DELETE CASCADE,
            book_id       TEXT NOT NULL,
            book_title    TEXT,
            chapter_count INTEGER,
            format        TEXT,
            chapters_data JSONB,
            created_at    TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.visits (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER REFERENCES {SCHEMA}.users(id) ON DELETE SET NULL,
            path        TEXT,
            country     TEXT,
            ip          TEXT,
            user_agent  TEXT,
            created_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)


def get_token_from_event(event: dict) -> str:
    """Extract Bearer token from X-Authorization header."""
    headers = event.get('headers') or {}
    auth_header = (
        headers.get('X-Authorization')
        or headers.get('x-authorization')
        or headers.get('Authorization')
        or headers.get('authorization')
        or ''
    )
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    return auth_header.strip()


def get_user_by_token(cur, token: str):
    """Return user row by session token or None."""
    if not token:
        return None
    safe_token = esc(token)
    cur.execute(f"""
        SELECT u.id, u.email, u.name, u.avatar, u.is_admin
        FROM {SCHEMA}.sessions s
        JOIN {SCHEMA}.users u ON u.id = s.user_id
        WHERE s.token = {safe_token}
        LIMIT 1
    """)
    row = cur.fetchone()
    if row:
        return {'id': row[0], 'email': row[1], 'name': row[2], 'avatar': row[3], 'is_admin': row[4]}
    return None


# ─── Actions ──────────────────────────────────────────────────────────────────

def action_google_login(body: dict) -> dict:
    token = (body.get('token') or '').strip()
    if not token:
        return resp(400, {'error': 'token is required'})

    try:
        r = requests.get(
            f'https://oauth2.googleapis.com/tokeninfo?id_token={token}',
            timeout=10,
        )
        if r.status_code != 200:
            return resp(401, {'error': 'Invalid Google token', 'detail': r.text})
        info = r.json()
    except Exception as e:
        log.error(f'Google tokeninfo error: {e}')
        return resp(502, {'error': 'Failed to verify Google token'})

    google_id = info.get('sub', '')
    email = info.get('email', '')
    name = info.get('name', '')
    picture = info.get('picture', '')

    if not google_id or not email:
        return resp(401, {'error': 'Google token missing sub/email'})

    is_admin = email == ADMIN_EMAIL

    try:
        conn = get_conn()
        conn.autocommit = False
        cur = conn.cursor()
        ensure_tables(cur)

        # UPSERT user
        s_google_id = esc(google_id)
        s_email = esc(email)
        s_name = esc(name)
        s_picture = esc(picture)
        s_is_admin = 'TRUE' if is_admin else 'FALSE'

        cur.execute(f"""
            INSERT INTO {SCHEMA}.users (google_id, email, name, avatar, is_admin)
            VALUES ({s_google_id}, {s_email}, {s_name}, {s_picture}, {s_is_admin})
            ON CONFLICT (google_id) DO UPDATE SET
                email    = EXCLUDED.email,
                name     = EXCLUDED.name,
                avatar   = EXCLUDED.avatar,
                is_admin = CASE
                    WHEN {SCHEMA}.users.email = {esc(ADMIN_EMAIL)} THEN TRUE
                    ELSE {SCHEMA}.users.is_admin
                END
            RETURNING id, email, name, avatar, is_admin
        """)
        row = cur.fetchone()
        user_id, u_email, u_name, u_avatar, u_is_admin = row

        # Create session
        session_token = secrets.token_hex(32)
        s_token = esc(session_token)
        cur.execute(f"""
            INSERT INTO {SCHEMA}.sessions (user_id, token)
            VALUES ({user_id}, {s_token})
        """)

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in google_login: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    return resp(200, {
        'token': session_token,
        'user': {
            'id': user_id,
            'email': u_email,
            'name': u_name,
            'avatar': u_avatar,
            'is_admin': u_is_admin,
        },
    })


def action_me(event: dict) -> dict:
    token = get_token_from_event(event)
    if not token:
        return resp(401, {'error': 'No token provided'})

    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_tables(cur)
        user = get_user_by_token(cur, token)
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in me: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    if not user:
        return resp(401, {'error': 'Session not found or expired'})

    return resp(200, {'user': user})


def action_logout(event: dict) -> dict:
    token = get_token_from_event(event)
    if not token:
        return resp(400, {'error': 'No token provided'})

    try:
        conn = get_conn()
        conn.autocommit = True
        cur = conn.cursor()
        ensure_tables(cur)
        s_token = esc(token)
        cur.execute(f"DELETE FROM {SCHEMA}.sessions WHERE token = {s_token}")
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in logout: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    return resp(200, {'ok': True})


def action_save_download(event: dict, body: dict) -> dict:
    token = get_token_from_event(event)
    if not token:
        return resp(401, {'error': 'Authorization required'})

    try:
        conn = get_conn()
        conn.autocommit = False
        cur = conn.cursor()
        ensure_tables(cur)
        user = get_user_by_token(cur, token)
        if not user:
            cur.close()
            conn.close()
            return resp(401, {'error': 'Session not found or expired'})

        book_id = str(body.get('book_id') or '')
        book_title = str(body.get('book_title') or '')
        chapter_count = int(body.get('chapter_count') or 0)
        fmt = str(body.get('format') or 'txt')
        chapters_data = body.get('chapters_data') or []

        s_user_id = str(user['id'])
        s_book_id = esc(book_id)
        s_book_title = esc(book_title)
        s_chapter_count = str(chapter_count)
        s_format = esc(fmt)
        s_chapters_data = esc(json.dumps(chapters_data, ensure_ascii=False))

        cur.execute(f"""
            INSERT INTO {SCHEMA}.downloads
                (user_id, book_id, book_title, chapter_count, format, chapters_data)
            VALUES
                ({s_user_id}, {s_book_id}, {s_book_title}, {s_chapter_count}, {s_format}, {s_chapters_data}::jsonb)
            RETURNING id
        """)
        row = cur.fetchone()
        download_id = row[0]
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in save_download: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    return resp(200, {'ok': True, 'id': download_id})


def action_get_history(event: dict) -> dict:
    token = get_token_from_event(event)
    if not token:
        return resp(401, {'error': 'Authorization required'})

    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_tables(cur)
        user = get_user_by_token(cur, token)
        if not user:
            cur.close()
            conn.close()
            return resp(401, {'error': 'Session not found or expired'})

        s_user_id = str(user['id'])
        cur.execute(f"""
            SELECT id, book_id, book_title, chapter_count, format, created_at
            FROM {SCHEMA}.downloads
            WHERE user_id = {s_user_id}
            ORDER BY created_at DESC
            LIMIT 100
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in get_history: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    history = [
        {
            'id': r[0],
            'book_id': r[1],
            'book_title': r[2],
            'chapter_count': r[3],
            'format': r[4],
            'created_at': str(r[5]),
        }
        for r in rows
    ]
    return resp(200, {'history': history})


def action_get_download(event: dict, body: dict) -> dict:
    token = get_token_from_event(event)
    if not token:
        return resp(401, {'error': 'Authorization required'})

    download_id = body.get('id')
    if not download_id:
        return resp(400, {'error': 'id is required'})

    try:
        conn = get_conn()
        cur = conn.cursor()
        ensure_tables(cur)
        user = get_user_by_token(cur, token)
        if not user:
            cur.close()
            conn.close()
            return resp(401, {'error': 'Session not found or expired'})

        s_user_id = str(user['id'])
        s_id = str(int(download_id))
        cur.execute(f"""
            SELECT id, book_id, book_title, chapter_count, format, chapters_data, created_at
            FROM {SCHEMA}.downloads
            WHERE id = {s_id} AND user_id = {s_user_id}
            LIMIT 1
        """)
        row = cur.fetchone()
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in get_download: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    if not row:
        return resp(404, {'error': 'Download not found'})

    return resp(200, {
        'download': {
            'id': row[0],
            'book_id': row[1],
            'book_title': row[2],
            'chapter_count': row[3],
            'format': row[4],
            'chapters_data': row[5],
            'created_at': str(row[6]),
        }
    })


def action_track_visit(event: dict, body: dict) -> dict:
    path = str(body.get('path') or '/')
    country = str(body.get('country') or '')

    # IP from requestContext
    ip = ''
    rc = event.get('requestContext') or {}
    identity = rc.get('identity') or {}
    ip = str(identity.get('sourceIp') or '')

    # User-Agent from headers
    headers = event.get('headers') or {}
    user_agent = str(
        headers.get('User-Agent')
        or headers.get('user-agent')
        or ''
    )

    # Optional: resolve user from token
    user_id_val = 'NULL'
    token = get_token_from_event(event)

    try:
        conn = get_conn()
        conn.autocommit = True
        cur = conn.cursor()
        ensure_tables(cur)

        if token:
            user = get_user_by_token(cur, token)
            if user:
                user_id_val = str(user['id'])

        s_path = esc(path)
        s_country = esc(country)
        s_ip = esc(ip)
        s_ua = esc(user_agent)

        cur.execute(f"""
            INSERT INTO {SCHEMA}.visits (user_id, path, country, ip, user_agent)
            VALUES ({user_id_val}, {s_path}, {s_country}, {s_ip}, {s_ua})
        """)
        cur.close()
        conn.close()
    except Exception as e:
        log.error(f'DB error in track_visit: {e}')
        return resp(500, {'error': 'Database error', 'detail': str(e)})

    return resp(200, {'ok': True})


# ─── Entry Point ──────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    action = (body.get('action') or '').strip()
    log.info(f'auth action={action}')

    if action == 'google_login':
        return action_google_login(body)
    if action == 'me':
        return action_me(event)
    if action == 'logout':
        return action_logout(event)
    if action == 'save_download':
        return action_save_download(event, body)
    if action == 'get_history':
        return action_get_history(event)
    if action == 'get_download':
        return action_get_download(event, body)
    if action == 'track_visit':
        return action_track_visit(event, body)

    return resp(400, {'error': f'Unknown action: {action}'})
