const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'wms_inventory',
    waitForConnections: true,
    connectionLimit: 10,
  });

  // Create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id VARCHAR(50) PRIMARY KEY,
      status VARCHAR(20),
      statusLabel VARCHAR(20),
      name VARCHAR(100),
      current INT,
      safe INT,
      diffText VARCHAR(50),
      recommendation VARCHAR(200),
      cycle VARCHAR(20),
      date DATE
    );
  `);

  const dataPath = path.join(__dirname, '../data/inventory.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  const items = JSON.parse(raw);

  const insertSQL = `INSERT INTO inventory_items (id, status, statusLabel, name, current, safe, diffText, recommendation, cycle, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
    status=VALUES(status), statusLabel=VALUES(statusLabel), name=VALUES(name), current=VALUES(current), safe=VALUES(safe), diffText=VALUES(diffText), recommendation=VALUES(recommendation), cycle=VALUES(cycle), date=VALUES(date);`;

  for (const item of items) {
    await pool.execute(insertSQL, [
      item.id,
      item.status,
      item.statusLabel,
      item.name,
      item.current,
      item.safe,
      item.diffText,
      item.recommendation,
      item.cycle,
      item.date,
    ]);
  }

  console.log('MySQL DB seeded with WMS inventory data');
  await pool.end();
})();
