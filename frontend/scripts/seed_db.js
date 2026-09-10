const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');

async function seed() {
  const db = await open({
    filename: path.join(__dirname, '../inventory.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      status TEXT,
      statusLabel TEXT,
      name TEXT,
      current INTEGER,
      safe INTEGER,
      diffText TEXT,
      recommendation TEXT,
      cycle TEXT,
      date TEXT
    );
  `);

  const rawData = fs.readFileSync(path.join(__dirname, '../data/seafood.json'), 'utf8');
  const items = JSON.parse(rawData);

  const insertQuery = `
    INSERT OR REPLACE INTO inventory_items 
    (id, status, statusLabel, name, current, safe, diffText, recommendation, cycle, date) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (const item of items) {
    await db.run(insertQuery, [
      item.id,
      item.status,
      item.statusLabel,
      item.name,
      item.current,
      item.safe,
      item.diffText,
      item.recommendation,
      item.cycle,
      item.date
    ]);
  }

  console.log("Database seeded successfully with seafood data!");
  await db.close();
}

seed().catch(err => {
  console.error("Error seeding DB:", err);
});
