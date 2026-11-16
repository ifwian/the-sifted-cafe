-- Database tests (run by tests/run_db_tests.sh against a throwaway local PostgreSQL).
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- helper: run a statement as a user, return the error code (or 'ok')
create or replace function pg_temp.as_user(uid uuid, sql text) returns text language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role ' || case when uid is null then 'anon' else 'authenticated' end;
  begin
    execute sql;
    res := 'ok';
  exception when others then
    res := case when sqlerrm in ('permission denied','x') then 'denied' else sqlerrm end;
    if sqlstate = '42501' then res := 'denied'; end if;
  end;
  execute 'reset role';
  return res;
end $$;

create or replace function pg_temp.expect(name text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got [%] want [%]', name, got, want; end if;
  raise notice 'PASS %', name;
end $$;

-- users: customers A, B, staff S
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'a@test.ph', '{"full_name":"Alice Cruz","phone":"09171234567"}'),
 ('00000000-0000-0000-0000-00000000000b', 'b@test.ph', '{"full_name":"Bob Reyes","phone":"09179876543","role":"staff"}'),
 ('00000000-0000-0000-0000-0000000000f0', 's@test.ph', '{"full_name":"Sam Staff","phone":"09170000000"}');
update public.profiles set role = 'staff' where email = 's@test.ph';

select pg_temp.expect('signup trigger creates profile with role customer (metadata role ignored)',
  (select string_agg(email || ':' || role, ',' order by email) from public.profiles), 'a@test.ph:customer,b@test.ph:customer,s@test.ph:staff');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
-- a booking date 3 days ahead (Manila) and a helper for later days
create temp table t as select ((now() at time zone 'Asia/Manila')::date + 3) as d3,
                              ((now() at time zone 'Asia/Manila')::date + 4) as d4,
                              ((now() at time zone 'Asia/Manila')::date + 5) as d5;
grant select on t to authenticated, anon;

select pg_temp.expect('customer A books (4 guests, downpayment)',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',4,'Birthday',null,'downpayment',null,'a/proof1.png','proof.png') $q$), 'ok');
select pg_temp.expect('amounts computed by the database (4 guests = 800 total, 240 due, proof_submitted, status pending)',
  (select total_amount || '/' || amount_due || '/' || p.status || '/' || r.status from public.reservations r join public.payments p on p.reservation_id=r.id limit 1), '800.00/240.00/proof_submitted/pending');

select pg_temp.expect('duplicate open booking for same slot rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',2,null,null,'full',null,null,null) $q$), 'duplicate');

-- 24h rule with all hours open (temporary change, rolled back by dropping later)
update public.branches set first_hour = 0, last_hour = 23 where code = 'cabuyao';
create temp table b as select date_trunc('hour', now() at time zone 'Asia/Manila' + interval '24 hours') as under;  -- start <= now+24h
grant select on b to authenticated;
select pg_temp.expect('24h: slot starting before now+24h is rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('cabuyao',(select under::date from b),(select under::time from b),2,null,null,'full',null,null,null) $q$), 'too_soon');
select pg_temp.expect('24h: slot 12h from now is rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('cabuyao',((now() at time zone 'Asia/Manila' + interval '12 hours')::date),(date_trunc('hour', now() at time zone 'Asia/Manila' + interval '12 hours'))::time,2,null,null,'full',null,null,null) $q$), 'too_soon');
select pg_temp.expect('24h: first slot at/after now+24h is accepted',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('cabuyao',((select under + interval '1 hour' from b)::date),((select under + interval '1 hour' from b)::time),2,null,null,'full',null,null,null) $q$), 'ok');
select pg_temp.expect('slot_availability marks <24h slots as not bookable',
  (select count(*) filter (where bookable)::text || '/' || count(*)::text from (select * from public.slot_availability('cabuyao', (now() at time zone 'Asia/Manila')::date)) s), '0/24');
update public.branches set first_hour = 9, last_hour = 20 where code = 'cabuyao';

select pg_temp.expect('past date rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(now() at time zone 'Asia/Manila')::date - 1,'12:00',2,null,null,'full',null,null,null) $q$), 'too_soon');
select pg_temp.expect('more than 60 days ahead rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(now() at time zone 'Asia/Manila')::date + 61,'12:00',2,null,null,'full',null,null,null) $q$), 'too_far');
select pg_temp.expect('outside opening hours rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d4 from t),'08:00',2,null,null,'full',null,null,null) $q$), 'bad_time');
select pg_temp.expect('non-hourly time rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d4 from t),'12:30',2,null,null,'full',null,null,null) $q$), 'bad_time');
select pg_temp.expect('1 guest rejected (min 2)',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d4 from t),'12:00',1,null,null,'full',null,null,null) $q$), 'bad_guests');
select pg_temp.expect('21 guests rejected at Calamba (capacity 20)',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d4 from t),'12:00',21,null,null,'full',null,null,null) $q$), 'bad_guests');
select pg_temp.expect('unknown branch rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('manila',(select d4 from t),'12:00',2,null,null,'full',null,null,null) $q$), 'bad_branch');
select pg_temp.expect('bad payment option rejected',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.create_reservation('calamba',(select d4 from t),'13:00',2,null,null,'free',null,null,null) $q$), 'bad_option');

-- capacity (Calamba = 20). Slot d3 12:00 already has A's 4 guests.
select pg_temp.expect('B books 12 -> total 16 ok',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000b', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',12,null,null,'full',null,'b/p.png','p.png') $q$), 'ok');
select pg_temp.expect('staff cannot book (customer accounts only)',
  pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',2,null,null,'full',null,null,null) $q$), 'not_customer');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'c@test.ph', '{"full_name":"Cara Dee","phone":"09175550000"}');
select pg_temp.expect('C asks for 5 seats when only 4 left -> slot_full',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000c', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',5,null,null,'full',null,null,null) $q$), 'slot_full');
select pg_temp.expect('C asks for exactly the 4 left -> ok',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000c', $q$ select public.create_reservation('calamba',(select d3 from t),'12:00',4,null,null,'downpayment',null,null,null) $q$), 'ok');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
create temp table rid as select
  (select id from public.reservations where user_id='00000000-0000-0000-0000-00000000000a' and branch='calamba') as a1,
  (select id from public.reservations where user_id='00000000-0000-0000-0000-00000000000a' and branch='cabuyao') as a2,
  (select id from public.reservations where user_id='00000000-0000-0000-0000-00000000000b') as b1,
  (select id from public.reservations where user_id='00000000-0000-0000-0000-00000000000c') as c1;
grant select on rid to authenticated;
select pg_temp.expect('seats_left now 0 for that slot',
  (select seats_left::text from public.slot_availability('calamba',(select d3 from t)) where slot='12:00'), '0') ;

-- RLS / privileges
select pg_temp.expect('A sees only own reservations',
  (select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ do $x$ begin if (select count(*) from public.reservation_details) <> 2 then raise exception 'saw %', (select count(*) from public.reservation_details); end if; end $x$ $q$)), 'ok');
select pg_temp.expect('anon cannot read reservations', pg_temp.as_user(null, 'select * from public.reservations'), 'denied');
select pg_temp.expect('anon cannot read profiles', pg_temp.as_user(null, 'select * from public.profiles'), 'denied');
select pg_temp.expect('anon cannot create reservations', pg_temp.as_user(null, $q$ select public.create_reservation('calamba',(select d5 from t),'12:00',2,null,null,'full',null,null,null) $q$), 'denied');
select pg_temp.expect('anon CAN read branches (public config)', pg_temp.as_user(null, 'select * from public.branches'), 'ok');
select pg_temp.expect('customer cannot INSERT reservations directly',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ insert into public.reservations (user_id,branch,reservation_date,reservation_time,guests) values ('00000000-0000-0000-0000-00000000000a','calamba',current_date+9,'12:00',2) $q$), 'denied');
select pg_temp.expect('customer cannot UPDATE reservation status directly',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ update public.reservations set status='confirmed' $q$), 'denied');
select pg_temp.expect('customer cannot UPDATE payments directly (self-verify)',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ update public.payments set status='verified' $q$), 'denied');
select pg_temp.expect('customer cannot promote self to staff',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ update public.profiles set role='staff' where id=auth.uid() $q$), 'denied');
select pg_temp.expect('customer cannot call staff_action',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.staff_action((select a1 from rid),'verify') $q$), 'forbidden');
select pg_temp.expect('customer cannot read proof path',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ select public.staff_proof_path((select a1 from rid)) $q$), 'forbidden');
select pg_temp.expect('customer cannot change settings',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000a', $q$ update public.cafe_settings set value='0' where key='min_advance_hours' $q$), 'denied');

-- cancel
select pg_temp.expect('B cannot cancel A''s reservation',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000b', $q$ select public.customer_cancel((select a1 from rid)) $q$), 'not_found');
select pg_temp.expect('C cancels own', pg_temp.as_user('00000000-0000-0000-0000-00000000000c', $q$ select public.customer_cancel((select c1 from rid)) $q$), 'ok');
select pg_temp.expect('cancelled seats are released', (select seats_left::text from public.slot_availability('calamba',(select d3 from t)) where slot='12:00'), '4');  -- run as superuser: no auth.uid

-- staff workflow (reservation 1 = A's, has a proof; reservation 2 = A's cabuyao, no proof)
select pg_temp.expect('staff sees all reservations',
  pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ do $x$ begin if (select count(*) from public.reservation_details) <> 4 then raise exception 'saw %', (select count(*) from public.reservation_details); end if; end $x$ $q$), 'ok');
select pg_temp.expect('cannot confirm before payment is verified',
  pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'confirm') $q$), 'payment_not_verified');
select pg_temp.expect('cannot verify a reservation with no proof',
  pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a2 from rid),'verify') $q$), 'no_proof');
select pg_temp.expect('staff verifies payment', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'verify') $q$), 'ok');
select pg_temp.expect('payment status verified + verifier recorded',
  (select p.status || '/' || (p.verified_by is not null)::text from public.payments p where reservation_id = (select a1 from rid)), 'verified/true');
select pg_temp.expect('staff confirms', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'confirm') $q$), 'ok');
select pg_temp.expect('cannot archive an open reservation', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'archive') $q$), 'not_finished');
select pg_temp.expect('staff rejects a payment proof (B, res 3)',
  pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select b1 from rid),'reject_payment','Amount does not match') $q$), 'ok');
select pg_temp.expect('rejected status + reason stored',
  (select status || '/' || rejection_reason from public.payments where reservation_id = (select b1 from rid)), 'rejected/Amount does not match');
select pg_temp.expect('customer re-submits proof after rejection',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000b', $q$ select public.customer_submit_proof((select b1 from rid),'b/new.png','new.png','123456789') $q$), 'ok');
select pg_temp.expect('proof resubmit locks once pending verification',
  pg_temp.as_user('00000000-0000-0000-0000-00000000000b', $q$ select public.customer_submit_proof((select b1 from rid),'b/x.png','x.png',null) $q$), 'proof_locked');
select pg_temp.expect('staff completes', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'complete') $q$), 'ok');
select pg_temp.expect('staff archives', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'archive') $q$), 'ok');
select pg_temp.expect('archived flag set', (select (archived_at is not null)::text from public.reservations where id = (select a1 from rid)), 'true');
select pg_temp.expect('staff restores', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'restore') $q$), 'ok');
select pg_temp.expect('cannot delete a non-archived reservation', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'delete') $q$), 'not_archived');
select pg_temp.expect('staff archives again + deletes', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a1 from rid),'archive'); select public.staff_action((select a1 from rid),'delete') $q$), 'ok');
select pg_temp.expect('delete cascades to payment', (select count(*)::text from public.payments where reservation_id = (select a1 from rid)), '0');
select pg_temp.expect('unknown action rejected', pg_temp.as_user('00000000-0000-0000-0000-0000000000f0', $q$ select public.staff_action((select a2 from rid),'explode') $q$), 'bad_action');
select pg_temp.expect('private storage bucket exists', (select (not public)::text || '/' || file_size_limit from storage.buckets where id='payment-proofs'), 'true/3145728');
\echo ALL DB TESTS PASSED
