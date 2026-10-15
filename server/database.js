// MySQL connection pool. The password comes from .env and never reaches the browser.
//
// A "pool" keeps a few connections open and lends one to each query, then
// takes it back automatically, so we never open or close connections by hand.

require('dotenv').config();
console.log("-> CONNECTING TO DATABASE:", process.env.DB_NAME);
console.log("-> HOST:", process.env.DB_HOST);
const mysql = require('mysql2/promise');
const { describeDbError } = require('./dbErrors');

const fs = require('fs');
const path = require('path');

// Cloud databases need an encrypted (TLS) connection. Set DB_SSL=true to turn it on.
// Some providers (for example Aiven) also give you a CA certificate file: save it as
// server/ca.pem and it is used automatically. The CA certificate is public, not a secret.
function buildSsl() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  const caFile = path.join(__dirname, 'ca.pem');
  if (fs.existsSync(caFile)) ssl.ca = fs.readFileSync(caFile);
  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sifted_cafe_db',
  waitForConnections: true,
  // Serverless functions run many copies of this app at once, so keep the
  // pool small there. On your own computer one process is enough.
  connectionLimit: process.env.VERCEL ? 2 : 10,
  // Cloud databases (Vercel deployment) need an encrypted connection.
  // Set DB_SSL=true in the Vercel environment variables; leave it out locally.
  ssl: buildSsl(),
  charset: 'utf8mb4',
  // Return DATE/TIME/TIMESTAMP columns as plain strings ('2026-10-20'),
  // not JavaScript Date objects, so time zones cannot shift the dates.
  dateStrings: true,
});

// Runs a SELECT and returns the rows.
// "?" placeholders are filled by the driver, never by string concatenation.
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Runs INSERT / UPDATE / DELETE and returns { insertId, affectedRows, ... }.
async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

module.exports = { pool, query, execute, describeDbError };