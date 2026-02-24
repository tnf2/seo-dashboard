const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'seo.db');

// Ensure data dir exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, keyword)
  );

  CREATE TABLE IF NOT EXISTS rank_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    position INTEGER,
    url TEXT,
    serp_data TEXT,
    checked_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS keyword_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER,
    competition REAL,
    cpc REAL,
    discovered_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_visibility (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    model TEXT,
    mentioned INTEGER DEFAULT 0,
    context TEXT,
    checked_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    cost REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, query)
  );
`);

// Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_rank_checks_keyword ON rank_checks(keyword_id, checked_at);
  CREATE INDEX IF NOT EXISTS idx_keywords_site ON keywords(site_id);
  CREATE INDEX IF NOT EXISTS idx_api_costs_date ON api_costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_visibility_site ON ai_visibility(site_id, checked_at);
`);

// Default settings
const defaultSettings = {
  dataforseo_login: 'h@candy.software',
  dataforseo_password: 'b8effaeafee353d5',
  check_frequency: 'daily',
  rank_check_cron: '0 6 * * *',
  discovery_cron: '0 7 * * 1',
  ai_visibility_cron: '0 8 * * 1',
  budget_alert: '50'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSetting.run(k, v);
}

// Seed data
const siteCount = db.prepare('SELECT COUNT(*) as c FROM sites').get().c;
if (siteCount === 0) {
  const insertSite = db.prepare('INSERT INTO sites (name, domain) VALUES (?, ?)');
  const result = insertSite.run('OPTCG Market', 'optcg.market');
  const siteId = result.lastInsertRowid;

  const insertKw = db.prepare('INSERT OR IGNORE INTO keywords (site_id, keyword) VALUES (?, ?)');
  const keywords = [
    'one piece tcg', 'one piece card game', 'optcg',
    'where to buy one piece cards', 'one piece cards for sale',
    'one piece tcg discord', 'buy one piece cards',
    'sell one piece cards', 'one piece booster box'
  ];
  for (const kw of keywords) {
    insertKw.run(siteId, kw);
  }

  // Seed AI queries
  const insertAiQuery = db.prepare('INSERT OR IGNORE INTO ai_queries (site_id, query) VALUES (?, ?)');
  insertAiQuery.run(siteId, 'best one piece tcg marketplace');
  insertAiQuery.run(siteId, 'where to buy one piece cards online');

  console.log('Seeded database with OPTCG Market and keywords');
}

module.exports = db;
