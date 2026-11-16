#!/usr/bin/env bash
# Runs the database tests on a throwaway local PostgreSQL (needs psql + a running server; no Supabase needed).
# Usage: tests/run_db_tests.sh        (uses the postgres superuser via the local socket)
set -euo pipefail
cd "$(dirname "$0")"
DB=sifted_test
psql_quiet() { runuser -u postgres -- env "PGOPTIONS=-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 "$@"; }
P=psql_quiet
runuser -u postgres -- dropdb --if-exists $DB
runuser -u postgres -- createdb $DB
$P -d $DB -f supabase_stub.sql
$P -d $DB -f ../supabase/schema.sql
$P -d $DB -f ../supabase/schema.sql   # second run proves the schema is re-runnable
runuser -u postgres -- env "PGOPTIONS=-c client_min_messages=notice" psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -d $DB -f db_test.sql 2>&1 | sed -E 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //'
# ---- concurrency: 10 customers book 4 guests each into ONE slot with capacity 20 at the same instant ----
for i in $(seq 1 10); do
  $P -d $DB -c "insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0001-0000000000$(printf %02d $i)','c$i@test.ph','{\"full_name\":\"Racer $i\",\"phone\":\"0917000000$i\"}')"
done
DATE=$($P -d $DB -At -c "select ((now() at time zone 'Asia/Manila')::date + 7)")
for i in $(seq 1 10); do
  ( $P -d $DB -At -c "set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0001-0000000000$(printf %02d $i)',false); select public.create_reservation('calamba','$DATE','15:00',4,null,null,'full',null,null,null)" >/dev/null 2>&1 && echo ok || echo fail ) > /tmp/race_$i.txt &
done
wait
OK=$(cat /tmp/race_*.txt | grep -c ok || true); rm -f /tmp/race_*.txt
GUESTS=$($P -d $DB -At -c "select coalesce(sum(guests),0) from reservations where reservation_date='$DATE' and reservation_time='15:00' and status in ('pending','confirmed')")
echo "RACE: $OK of 10 simultaneous bookings succeeded, $GUESTS guests booked (capacity 20)"
[ "$OK" = "5" ] && [ "$GUESTS" = "20" ] && echo "PASS concurrency: capacity never exceeded" || { echo "FAIL concurrency"; exit 1; }
runuser -u postgres -- dropdb $DB
