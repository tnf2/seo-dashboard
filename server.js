const express = require('express');
const path = require('path');
const db = require('./src/db');

async function main() {
  // Initialize database (async sql.js load)
  await db.initSync();

  const apiRoutes = require('./src/routes/api');
  const scheduler = require('./src/scheduler');

  const app = express();
  const PORT = process.env.PORT || 3456;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api', apiRoutes);

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`SEO Dashboard running at http://localhost:${PORT}`);
    scheduler.start();
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
