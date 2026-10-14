// Translates database errors into (a) safe text for the browser and (b) a
// helpful hint for the developer's terminal. Kept separate from database.js
// so it has no dependencies and can be unit tested.

// Turns a database error into { status, message, hint }.
//   message - safe text for the browser (no technical details)
//   hint    - helpful text for the developer's terminal
function describeDbError(err) {
  const code = err && err.code;
  const unavailable = {
    status: 503,
    message: 'The reservation system is temporarily unavailable. Please try again later or contact the cafe directly.',
  };
  switch (code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ER_CON_COUNT_ERROR':
      return { ...unavailable, hint: 'Cannot reach MySQL. Is the MySQL server running, and are DB_HOST and DB_PORT in .env correct?' };
    case 'ER_ACCESS_DENIED_ERROR':
      return { ...unavailable, hint: 'MySQL refused the login. Check DB_USER and DB_PASSWORD in .env.' };
    case 'ER_BAD_DB_ERROR':
      return { ...unavailable, hint: 'The database does not exist. Import database.sql in MySQL Workbench, and check DB_NAME in .env.' };
    case 'ER_NO_SUCH_TABLE':
      return { ...unavailable, hint: 'A table is missing. Run database.sql in MySQL Workbench to create the tables.' };
    default:
      return {
        status: 500,
        message: 'Something went wrong on our side. Please try again.',
        hint: `Unexpected database error${code ? ` (${code})` : ''}: ${err && err.message}`,
      };
  }
}

module.exports = { describeDbError };
