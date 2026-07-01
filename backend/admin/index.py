import json
import logging
import os

import psycopg2

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


def get_admin_user(cur, token: str):
    """Return admin user row by session token or None if not admin / not found."""
    if not token:
        return None
    s_token = esc(token)
    cur.execute(f"""
        SELECT u.id, u.email, u.name, u.is_admin
        FROM {SCHEMA}.sessions s
        JOIN {SCHEMA}.users u ON u.id = s.user_id
        WHERE s.token = {s_token}
          AND u.is_admin = TRUE
        LIMIT 1
    """)
    row = cur.fetchone()
    if row:
        return {'id': row[0], 'email': row[1], 'name': row[2], 'is_admin': row[3]}
    return None


def check_auth(event: dict, cur):
    """
    Verify request has a valid admin session.
    Returns (user, error_response). If error_response is not None, return it immediately.
    """
    token = get_token_from_event(event)
    if not token:
        return None, resp(401, {'error': 'Authorization required'})
    user = get_admin_user(cur, token)
    if not user:
        # Check whether the session exists at all (to distinguish 401 vs 403)
        s_token = esc(token)
        cur.execute(f"""
            SELECT u.id
            FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = {s_token}
            LIMIT 1
        """)
        exists = cur.fetchone()
        if not exists:
            return None, resp(401, {'error': 'Session not found or expired'})
        return None, resp(403, {'error': 'Admin access required'})
    return user, None


# ─── Actions ──────────────────────────────────────────────────────────────────

def action_stats(cur) -> dict:
    # total_users
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users")
    total_users = cur.fetchone()[0]

    # total_downloads
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.downloads")
    total_downloads = cur.fetchone()[0]

    # total_visits
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.visits")
    total_visits = cur.fetchone()[0]

    # top 5 books by downloads count
    cur.execute(f"""
        SELECT book_id, book_title, format, chapter_count, COUNT(*) AS cnt
        FROM {SCHEMA}.downloads
        GROUP BY book_id, book_title, format, chapter_count
        ORDER BY cnt DESC
        LIMIT 5
    """)
    rows = cur.fetchall()
    top_books = [
        {
            'book_id': r[0],
            'book_title': r[1],
            'format': r[2],
            'chapter_count': r[3],
            'downloads': r[4],
        }
        for r in rows
    ]

    # recent 20 visits with optional user email
    cur.execute(f"""
        SELECT v.ip, v.country, v.user_agent, v.created_at, u.email
        FROM {SCHEMA}.visits v
        LEFT JOIN {SCHEMA}.users u ON u.id = v.user_id
        ORDER BY v.created_at DESC
        LIMIT 20
    """)
    rows = cur.fetchall()
    recent_visits = [
        {
            'ip': r[0],
            'country': r[1],
            'user_agent': r[2],
            'created_at': str(r[3]),
            'email': r[4],
        }
        for r in rows
    ]

    return resp(200, {
        'total_users': total_users,
        'total_downloads': total_downloads,
        'total_visits': total_visits,
        'top_books': top_books,
        'recent_visits': recent_visits,
    })


def action_users(cur) -> dict:
    cur.execute(f"""
        SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
               COUNT(d.id) AS download_count
        FROM {SCHEMA}.users u
        LEFT JOIN {SCHEMA}.downloads d ON d.user_id = u.id
        GROUP BY u.id, u.email, u.name, u.is_admin, u.created_at
        ORDER BY u.created_at DESC
    """)
    rows = cur.fetchall()
    users = [
        {
            'id': r[0],
            'email': r[1],
            'name': r[2],
            'is_admin': r[3],
            'created_at': str(r[4]),
            'download_count': r[5],
        }
        for r in rows
    ]
    return resp(200, {'users': users})


def action_set_admin(cur, conn, body: dict) -> dict:
    user_id = body.get('user_id')
    is_admin = body.get('is_admin')

    if user_id is None or is_admin is None:
        return resp(400, {'error': 'user_id and is_admin are required'})

    s_user_id = str(int(user_id))
    s_is_admin = 'TRUE' if is_admin else 'FALSE'

    cur.execute(f"""
        UPDATE {SCHEMA}.users
        SET is_admin = {s_is_admin}
        WHERE id = {s_user_id}
        RETURNING id, email, is_admin
    """)
    row = cur.fetchone()
    conn.commit()

    if not row:
        return resp(404, {'error': 'User not found'})

    return resp(200, {
        'ok': True,
        'user': {'id': row[0], 'email': row[1], 'is_admin': row[2]},
    })


# ─── Entry Point ──────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    action = (body.get('action') or '').strip()
    log.info(f'admin action={action}')

    try:
        conn = get_conn()
        conn.autocommit = False
        cur = conn.cursor()
    except Exception as e:
        log.error(f'DB connect error: {e}')
        return resp(500, {'error': 'Database connection error', 'detail': str(e)})

    try:
        user, err = check_auth(event, cur)
        if err:
            return err

        if action == 'stats':
            return action_stats(cur)
        if action == 'users':
            return action_users(cur)
        if action == 'set_admin':
            return action_set_admin(cur, conn, body)

        return resp(400, {'error': f'Unknown action: {action}'})

    except Exception as e:
        log.error(f'Handler error: {e}')
        return resp(500, {'error': 'Internal server error', 'detail': str(e)})
    finally:
        try:
            cur.close()
            conn.close()
        except Exception:
            pass
