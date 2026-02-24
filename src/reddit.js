const fetch = require('node-fetch');
const db = require('./db');

const USER_AGENT = 'SEODashboard/1.0 (monitoring)';
const RATE_LIMIT_MS = 2000; // Reddit rate limit: be nice

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchReddit(keyword, subreddit = null) {
  let url;
  if (subreddit) {
    url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=on&sort=new&limit=25`;
  } else {
    url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=new&limit=25`;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) {
    console.error(`[Reddit] HTTP ${res.status} for ${url}`);
    return [];
  }

  const data = await res.json();
  if (!data?.data?.children) return [];

  return data.data.children
    .filter(c => c.kind === 't3')
    .map(c => ({
      post_id: c.data.id,
      title: c.data.title,
      subreddit: c.data.subreddit,
      url: `https://www.reddit.com${c.data.permalink}`,
      score: c.data.score,
      num_comments: c.data.num_comments,
      author: c.data.author,
      created_utc: c.data.created_utc
    }));
}

function isOpportunity(post) {
  const title = (post.title || '').toLowerCase();
  const isQuestion = title.includes('?') || title.startsWith('how') || title.startsWith('where') || 
    title.startsWith('what') || title.startsWith('best') || title.startsWith('any') ||
    title.includes('recommend') || title.includes('looking for') || title.includes('help');
  const isRecent = (Date.now() / 1000 - post.created_utc) < 86400 * 3; // within 3 days
  const hasEngagement = post.score >= 3 || post.num_comments >= 2;
  return (isQuestion && isRecent) || (hasEngagement && isRecent) ? 1 : 0;
}

async function runRedditChecks() {
  console.log('[Reddit] Starting Reddit checks...');
  const sites = db.prepare('SELECT * FROM sites').all();

  for (const site of sites) {
    const keywords = db.prepare('SELECT * FROM reddit_keywords WHERE site_id = ?').all(site.id);

    for (const kw of keywords) {
      try {
        let subreddits;
        try { subreddits = JSON.parse(kw.subreddits); } catch { subreddits = []; }
        
        let allPosts = [];

        if (subreddits.length > 0) {
          for (const sub of subreddits) {
            const posts = await searchReddit(kw.keyword, sub);
            allPosts.push(...posts);
            await sleep(RATE_LIMIT_MS);
          }
        } else {
          allPosts = await searchReddit(kw.keyword);
          await sleep(RATE_LIMIT_MS);
        }

        const insert = db.prepare(
          `INSERT OR IGNORE INTO reddit_mentions (site_id, keyword_id, post_id, title, subreddit, url, score, num_comments, author, created_utc, is_opportunity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        let newCount = 0;
        for (const post of allPosts) {
          const r = insert.run(
            site.id, kw.id, post.post_id, post.title, post.subreddit,
            post.url, post.score, post.num_comments, post.author,
            post.created_utc, isOpportunity(post)
          );
          if (r.changes > 0) newCount++;
        }

        console.log(`[Reddit] ${kw.keyword}: ${newCount} new posts from ${allPosts.length} results`);
      } catch (err) {
        console.error(`[Reddit] Error checking "${kw.keyword}":`, err.message);
      }
    }
  }
  console.log('[Reddit] Checks complete');
}

module.exports = { runRedditChecks, searchReddit };
