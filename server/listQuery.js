// Builds the SQL filter for the admin reservation list.
// Pure function: it takes the URL query (?status=pending&search=ana ...) and
// returns pieces of SQL plus the matching parameter values. User text is
// NEVER pasted into the SQL: it always travels in the params array ("?").

const config = require('./config');
const { isRealDate } = require('./validation');

// The user can only choose from these fixed ORDER BY clauses.
const SORT_OPTIONS = {
  newest: 'created_at DESC, id DESC',
  upcoming: 'reservation_date ASC, reservation_time ASC, id ASC',
  latest_date: 'reservation_date DESC, reservation_time DESC, id DESC',
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 15;

// "50%" should search for the text 50%, not "50 followed by anything".
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parseListQuery(query = {}) {
  const where = [];
  const params = [];
  const first = (v) => (Array.isArray(v) ? v[0] : v);

  const status = first(query.status);
  if (status) {
    if (!config.statuses.includes(status)) return { error: 'Unknown status filter.' };
    where.push('status = ?');
    params.push(status);
  }

  const branch = first(query.branch);
  if (branch) {
    if (!config.branches.some((b) => b.id === branch)) return { error: 'Unknown branch filter.' };
    where.push('branch = ?');
    params.push(branch);
  }

  const dateFrom = first(query.dateFrom);
  if (dateFrom) {
    if (!isRealDate(dateFrom)) return { error: 'The "from" date is not valid.' };
    where.push('reservation_date >= ?');
    params.push(dateFrom);
  }

  const dateTo = first(query.dateTo);
  if (dateTo) {
    if (!isRealDate(dateTo)) return { error: 'The "to" date is not valid.' };
    where.push('reservation_date <= ?');
    params.push(dateTo);
  }

  const search = String(first(query.search) || '').trim().slice(0, 100);
  if (search) {
    const like = `%${escapeLike(search)}%`;
    const refMatch = /^(?:sc-?)?(\d{1,10})$/i.exec(search); // "SC-00012" or "12"
    if (refMatch) {
      where.push('(customer_name LIKE ? OR phone LIKE ? OR email LIKE ? OR id = ?)');
      params.push(like, like, like, Number(refMatch[1]));
    } else {
      where.push('(customer_name LIKE ? OR phone LIKE ? OR email LIKE ?)');
      params.push(like, like, like);
    }
  }

  const sortKey = first(query.sort) || 'newest';
  if (!Object.prototype.hasOwnProperty.call(SORT_OPTIONS, sortKey)) return { error: 'Unknown sort option.' };

  const page = first(query.page) === undefined ? 1 : Number(first(query.page));
  const pageSize = first(query.pageSize) === undefined ? DEFAULT_PAGE_SIZE : Number(first(query.pageSize));
  if (!Number.isInteger(page) || page < 1) return { error: 'Page must be a positive whole number.' };
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `Page size must be between 1 and ${MAX_PAGE_SIZE}.` };
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    orderBy: SORT_OPTIONS[sortKey],
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

module.exports = { parseListQuery, escapeLike, SORT_OPTIONS };
