// Unit tests for server/listQuery.js (the admin search and filter SQL builder).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListQuery, escapeLike } = require('../../server/listQuery');

test('no filters: no WHERE, newest first, first page of 15', () => {
  const q = parseListQuery({});
  assert.equal(q.whereSql, '');
  assert.deepEqual(q.params, []);
  assert.match(q.orderBy, /created_at DESC/);
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 15);
  assert.equal(q.offset, 0);
});

test('filters become placeholders with separate parameter values', () => {
  const q = parseListQuery({ status: 'pending', branch: 'calamba', dateFrom: '2026-10-01', dateTo: '2026-10-31' });
  assert.equal(q.whereSql, 'WHERE status = ? AND branch = ? AND reservation_date >= ? AND reservation_date <= ?');
  assert.deepEqual(q.params, ['pending', 'calamba', '2026-10-01', '2026-10-31']);
});

test('search text never appears inside the SQL', () => {
  const evil = "x' OR '1'='1";
  const q = parseListQuery({ search: evil });
  assert.ok(!q.whereSql.includes('OR \'1\''));
  assert.equal(q.params.length, 3);
  assert.ok(q.params.every((p) => p.includes(evil)));
});

test('search for a reference number also matches the id', () => {
  const q = parseListQuery({ search: 'SC-00012' });
  assert.match(q.whereSql, /id = \?/);
  assert.equal(q.params[3], 12);
  assert.match(parseListQuery({ search: '7' }).whereSql, /id = \?/);
  assert.doesNotMatch(parseListQuery({ search: 'Ana' }).whereSql, /id = \?/);
});

test('LIKE wildcards typed by the user are escaped', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  assert.equal(parseListQuery({ search: '100%' }).params[0], '%100\\%%');
});

test('unknown status, branch, sort, dates and bad paging are rejected', () => {
  for (const bad of [
    { status: 'nope' }, { branch: 'nowhere' }, { sort: 'id; DROP TABLE x' },
    { dateFrom: '2026-02-31' }, { dateTo: 'tomorrow' },
    { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'abc' },
    { pageSize: '0' }, { pageSize: '101' }, { pageSize: 'ten' },
  ]) {
    assert.ok(parseListQuery(bad).error, `should reject ${JSON.stringify(bad)}`);
  }
});

test('paging computes the offset and sort options map to fixed ORDER BY text', () => {
  const q = parseListQuery({ page: '3', pageSize: '20', sort: 'upcoming' });
  assert.equal(q.offset, 40);
  assert.match(q.orderBy, /reservation_date ASC/);
});

test('repeated query parameters (arrays) do not break the parser', () => {
  const q = parseListQuery({ status: ['pending', 'confirmed'] });
  assert.deepEqual(q.params, ['pending']);
});
