CREATE TABLE IF NOT EXISTS t_p74407000_webnovel_download_pr.users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(128) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar VARCHAR(512),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p74407000_webnovel_download_pr.downloads (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES t_p74407000_webnovel_download_pr.users(id),
    book_id VARCHAR(64),
    book_title VARCHAR(512),
    chapter_count INTEGER,
    format VARCHAR(16),
    chapters_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p74407000_webnovel_download_pr.visits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES t_p74407000_webnovel_download_pr.users(id),
    ip VARCHAR(64),
    country VARCHAR(128),
    user_agent TEXT,
    path VARCHAR(256),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p74407000_webnovel_download_pr.sessions (
    id SERIAL PRIMARY KEY,
    token VARCHAR(256) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES t_p74407000_webnovel_download_pr.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

CREATE TABLE IF NOT EXISTS t_p74407000_webnovel_download_pr.translations (
    id SERIAL PRIMARY KEY,
    download_id INTEGER REFERENCES t_p74407000_webnovel_download_pr.downloads(id),
    chapter_id VARCHAR(64),
    chapter_name VARCHAR(512),
    original_text TEXT,
    translated_text TEXT,
    status VARCHAR(32) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO t_p74407000_webnovel_download_pr.users (google_id, email, name, is_admin)
VALUES ('latikant82_pending', 'latikant82@gmail.com', 'Admin', TRUE)
ON CONFLICT (email) DO UPDATE SET is_admin = TRUE;
