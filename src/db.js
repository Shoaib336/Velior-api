// MySQL connection pool built from env vars (lazy: no connection until first query).
// Sessions run in UTC and mysql2 reads/writes dates as UTC, so a TIMESTAMP is
// the same instant in JS whatever time zone the DB server is set to. Calendar
// days (dashboard, date filters) are then worked out in Node's own zone (TZ).
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  dateStrings: ['DATE'], // calendar dates stay "YYYY-MM-DD", no zone shift
});

pool.pool.on('connection', (conn) => {
  // Queued ahead of the connection's first real query.
  conn.query("SET time_zone = '+00:00'", (err) => err && console.error('SET time_zone failed', err));
});

/** Runs `work(conn)` in a transaction on its own pooled connection. */
export const transaction = async (work) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export default pool;
