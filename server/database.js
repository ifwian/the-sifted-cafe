// MySQL connection pool. The password comes from .env and never reaches the browser.
//
// A "pool" keeps a few connections open and lends one to each query, then
// takes it back automatically, so we never open or close connections by hand.

require('dotenv').config();
const mysql = require('mysql2/promise');
const { describeDbError } = require('./dbErrors');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sifted_cafe_db',
  waitForConnections: true,
  connectionLimit: 10,
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
