-- =====================================================================
-- THE SIFTED CAFE & BAKERY - Supabase (PostgreSQL) schema
--
-- HOW TO USE: Supabase Dashboard > SQL Editor > New query > paste this whole
-- file > Run. It is safe to run again (idempotent). No editing needed.
--
-- TABLES
--   profiles      one row per account (customer or staff), linked to Supabase Auth
--   branches      the cafe's branches: opening hours and seating capacity
--   cafe_settings booking rules and payment instructions (24h notice, deposit %, ...)
--   reservations  one row per reservation request
--   payments      exactly one GCash payment per reservation
--
-- SECURITY MODEL
--   * Row Level Security (RLS) is ON for every table.
--   * Customers can only READ their own rows. Nobody writes tables directly:
--     every change goes through the SECURITY DEFINER functions below, which
--     check who is calling (auth.uid()) and enforce the business rules.
--   * Staff are rows in profiles with role = 'staff'. A role can only be
--     changed from the SQL Editor (see supabase/README.md), never from the app.
--   * Timezone rule: every reservation date/time is Asia/Manila local time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.branches (
  code       text primary key check (code ~ '^[a-z0-9_-]+$'),
  name       text not null,
  first_hour smallint not null check (first_hour between 0 and 23),  -- first bookable hour (24h clock)
  last_hour  smallint not null check (last_hour  between 0 and 23),  -- last bookable hour (1 hour before closing)
  capacity   smallint not null check (capacity > 0),                 -- max guests per hourly slot
  active     boolean  not null default true,
  check (first_hour <= last_hour)
);

create table if not exists public.cafe_settings (
  key         text primary key,
  value       text not null,
  description text
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (char_length(full_name) between 2 and 100),
  email      text not null,
  phone      text not null check (phone ~ '^\+?[0-9 ()-]{7,30}$'),
  role       text not null default 'customer' check (role in ('customer', 'staff')),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_profiles_email on public.profiles (lower(email));

create table if not exists public.reservations (
  id               bigint generated always as identity primary key,
  user_id          uuid     not null references public.profiles (id) on delete restrict,
  branch           text     not null references public.branches (code),
  reservation_date date     not null,   -- Asia/Manila local date
  reservation_time time     not null,   -- Asia/Manila local time, on the hour
  guests           smallint not null check (guests >= 1),
  occasion         text check (char_length(occasion) <= 100),
  special_requests text check (char_length(special_requests) <= 500),
  status           text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  admin_notes      text check (char_length(admin_notes) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  check (extract(minute from reservation_time) = 0 and extract(second from reservation_time) = 0)
);
-- A customer cannot hold two open reservations for the same branch/date/time (double-click protection).
create unique index if not exists uq_res_open_per_customer_slot
  on public.reservations (user_id, branch, reservation_date, reservation_time)
  where status in ('pending', 'confirmed');
create index if not exists idx_res_slot on public.reservations (branch, reservation_date, reservation_time)
  where status in ('pending', 'confirmed');
create index if not exists idx_res_user on public.reservations (user_id, reservation_date desc);
create index if not exists idx_res_list on public.reservations (archived_at, reservation_date, reservation_time);

create table if not exists public.payments (
  id                  bigint generated always as identity primary key,
  reservation_id      bigint not null unique references public.reservations (id) on delete cascade,
  method              text not null default 'gcash' check (method = 'gcash'),
  payment_option      text not null check (payment_option in ('downpayment', 'full')),
  total_amount        numeric(10, 2) not null check (total_amount >= 0),
  amount_due          numeric(10, 2) not null check (amount_due >= 0),
  reference_number    text check (reference_number ~ '^[0-9]{6,20}$'),
  proof_original_name text check (char_length(proof_original_name) <= 150),
  proof_path          text,                       -- object path in the private "payment-proofs" bucket
  status              text not null default 'unpaid'
                      check (status in ('unpaid', 'proof_submitted', 'verified', 'rejected')),
  rejection_reason    text check (char_length(rejection_reason) <= 300),
  verified_by         uuid references public.profiles (id) on delete set null,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (amount_due <= total_amount)
);
create index if not exists idx_pay_status on public.payments (status);

-- ---------------------------------------------------------------------
-- 2. SETTINGS (cafe rules). Safe defaults; edit the values in the Table Editor.
--    Rates marked PLACEHOLDER were never confirmed by the cafe.
-- ---------------------------------------------------------------------
insert into public.branches (code, name, first_hour, last_hour, capacity) values
  ('calamba', 'Calamba', 10, 21, 20),
  ('cabuyao', 'Cabuyao',  9, 20, 30)
on conflict (code) do nothing;

insert into public.cafe_settings (key, value, description) values
  ('min_advance_hours',       '24',         'Reservations must start at least this many hours from now'),
  ('max_days_ahead',          '60',         'PLACEHOLDER: how far ahead customers may book'),
  ('min_guests',              '2',          'Smallest party for an online reservation'),
  ('duration_hours',          '2',          'PLACEHOLDER: how long a table is held'),
  ('reservation_fee',         '0',          'PLACEHOLDER: fixed fee per reservation (pesos)'),
  ('minimum_spend_per_guest', '200',        'PLACEHOLDER: minimum spend per guest (pesos)'),
  ('downpayment_percent',     '30',         'PLACEHOLDER: downpayment as % of the total'),
  ('cancel_hours_before',     '24',         'Free cancellation until this many hours before the reservation'),
  ('gcash_recipient',         'RO****O N.', 'Name GCash shows for the cafe QR code'),
  ('gcash_note',              'GCash shows that transfer fees may apply when you pay with this QR.', 'Shown under the QR code')
on conflict (key) do nothing;

create or replace function public.setting_int(p_key text) returns integer
language sql stable set search_path = public as
$$ select value::integer from public.cafe_settings where key = p_key $$;

-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------

-- New Supabase Auth user -> profile row. The role is ALWAYS 'customer' here, whatever the sign-up sends.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, full_name, email, phone, role)
  values (new.id,
          trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')),
          new.email,
          trim(coalesce(new.raw_user_meta_data ->> 'phone', '')),
          'customer');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step with Supabase Auth.
create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_user_email();

-- Nobody can change a role from the app (only from the SQL Editor, where auth.uid() is null).
create or replace function public.guard_profile_role() returns trigger
language plpgsql set search_path = public as
$$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role_change_forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role before update on public.profiles
  for each row execute function public.guard_profile_role();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists touch_reservations on public.reservations;
create trigger touch_reservations before update on public.reservations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. HELPERS
-- ---------------------------------------------------------------------

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff') $$;

-- The moment a reservation starts, as a real point in time (Asia/Manila).
create or replace function public.slot_start(p_date date, p_time time) returns timestamptz
language sql immutable as
$$ select ((p_date + p_time) at time zone 'Asia/Manila') $$;

-- Raise a coded error. The Node API turns the code into a friendly message for the form field in `detail`.
create or replace function public.fail(p_code text, p_field text default null) returns void
language plpgsql as $$ begin raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_field, ''); end $$;

-- ---------------------------------------------------------------------
-- 5. RESERVATION FUNCTIONS
-- ---------------------------------------------------------------------

-- Seats left per hourly slot, and whether the slot passes the advance-notice rule.
create or replace function public.slot_availability(p_branch text, p_date date)
returns table (slot text, seats_left integer, bookable boolean)
language plpgsql stable security definer set search_path = public as
$$
declare b public.branches; earliest timestamptz;
begin
  if auth.uid() is null then perform public.fail('not_signed_in'); end if;
  select * into b from public.branches where code = p_branch and active;
  if not found then perform public.fail('bad_branch', 'branch'); end if;
  earliest := now() + make_interval(hours => public.setting_int('min_advance_hours'));
  return query
    select to_char(make_time(h, 0, 0), 'HH24:MI'),
           greatest(b.capacity - coalesce((select sum(r.guests) from public.reservations r
              where r.branch = p_branch and r.reservation_date = p_date
                and r.reservation_time = make_time(h, 0, 0)
                and r.status in ('pending', 'confirmed')), 0), 0)::integer,
           public.slot_start(p_date, make_time(h, 0, 0)) >= earliest
    from generate_series(b.first_hour::integer, b.last_hour::integer) as h
    order by h;
end $$;

-- Create a reservation + its payment in ONE transaction. Every rule is enforced HERE, with the database clock:
-- signed in, customer role, 24-hour notice, opening hours, party size, capacity (advisory lock = no overbooking).
create or replace function public.create_reservation(
  p_branch text, p_date date, p_time time, p_guests integer,
  p_occasion text, p_requests text,
  p_payment_option text, p_reference text, p_proof_path text, p_proof_name text
) returns bigint
language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid(); b public.branches; res_id bigint; used integer;
  total numeric; due numeric; fee integer; per_guest integer; pct integer;
begin
  if uid is null then perform public.fail('not_signed_in'); end if;
  if not exists (select 1 from public.profiles where id = uid and role = 'customer') then
    perform public.fail('not_customer');
  end if;

  select * into b from public.branches where code = p_branch and active;
  if not found then perform public.fail('bad_branch', 'branch'); end if;
  if p_guests is null or p_guests < public.setting_int('min_guests') or p_guests > b.capacity then
    perform public.fail('bad_guests', 'guests');
  end if;
  if p_date is null or p_time is null then perform public.fail('bad_date', 'date'); end if;
  if extract(minute from p_time) <> 0 or extract(second from p_time) <> 0
     or extract(hour from p_time) < b.first_hour or extract(hour from p_time) > b.last_hour then
    perform public.fail('bad_time', 'time');
  end if;
  -- 24-hour advance rule (database clock, Asia/Manila start time)
  if public.slot_start(p_date, p_time) < now() + make_interval(hours => public.setting_int('min_advance_hours')) then
    perform public.fail('too_soon', 'date');
  end if;
  if p_date > ((now() at time zone 'Asia/Manila')::date + public.setting_int('max_days_ahead')) then
    perform public.fail('too_far', 'date');
  end if;
  if p_payment_option not in ('downpayment', 'full') then perform public.fail('bad_option', 'payment_option'); end if;
  if p_reference is not null and p_reference !~ '^[0-9]{6,20}$' then perform public.fail('bad_reference', 'payment_reference'); end if;

  -- Serialise bookings for this exact slot so two customers cannot both take the last seats.
  perform pg_advisory_xact_lock(hashtextextended(p_branch || '|' || p_date::text || '|' || p_time::text, 0));
  select coalesce(sum(guests), 0) into used from public.reservations
   where branch = p_branch and reservation_date = p_date and reservation_time = p_time
     and status in ('pending', 'confirmed');
  if used + p_guests > b.capacity then perform public.fail('slot_full', 'time'); end if;

  begin
    insert into public.reservations (user_id, branch, reservation_date, reservation_time, guests, occasion, special_requests)
    values (uid, p_branch, p_date, p_time, p_guests, nullif(trim(p_occasion), ''), nullif(trim(p_requests), ''))
    returning id into res_id;
  exception when unique_violation then
    perform public.fail('duplicate', 'time');
  end;

  -- Amounts are worked out here. The browser never sends a price or a payment status.
  fee := public.setting_int('reservation_fee'); per_guest := public.setting_int('minimum_spend_per_guest');
  pct := public.setting_int('downpayment_percent');
  total := fee + p_guests * per_guest;
  due := case p_payment_option when 'full' then total else least(ceil(total * pct / 100.0), total) end;

  insert into public.payments (reservation_id, payment_option, total_amount, amount_due, reference_number,
                               proof_original_name, proof_path, status)
  values (res_id, p_payment_option, total, due, nullif(p_reference, ''), p_proof_name, p_proof_path,
          case when p_proof_path is null then 'unpaid' else 'proof_submitted' end);
  return res_id;
end $$;

-- A customer cancels THEIR OWN open reservation (until it starts).
create or replace function public.customer_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = public as
$$
declare r public.reservations;
begin
  if auth.uid() is null then perform public.fail('not_signed_in'); end if;
  select * into r from public.reservations where id = p_id and user_id = auth.uid() for update;
  if not found then perform public.fail('not_found'); end if;
  if r.status not in ('pending', 'confirmed') then perform public.fail('not_open'); end if;
  if public.slot_start(r.reservation_date, r.reservation_time) <= now() then perform public.fail('already_started'); end if;
  update public.reservations
     set status = 'cancelled',
         admin_notes = right(trim(coalesce(admin_notes, '') || ' [Cancelled by customer ' ||
                       to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ']'), 500)
   where id = p_id;
end $$;

-- A customer (re)submits a payment proof for their own pending reservation (first proof was missing or rejected).
create or replace function public.customer_submit_proof(p_id bigint, p_path text, p_name text, p_reference text)
returns void language plpgsql security definer set search_path = public as
$$
declare p public.payments;
begin
  if auth.uid() is null then perform public.fail('not_signed_in'); end if;
  select p2.* into p from public.payments p2 join public.reservations r on r.id = p2.reservation_id
   where r.id = p_id and r.user_id = auth.uid() and r.status = 'pending' for update of p2;
  if not found then perform public.fail('not_found'); end if;
  if p.status not in ('unpaid', 'rejected') then perform public.fail('proof_locked'); end if;
  if p_reference is not null and p_reference !~ '^[0-9]{6,20}$' then perform public.fail('bad_reference', 'payment_reference'); end if;
  update public.payments
     set proof_path = p_path, proof_original_name = p_name, reference_number = coalesce(nullif(p_reference, ''), reference_number),
         status = 'proof_submitted', rejection_reason = null
   where id = p.id;
end $$;

-- ---------------------------------------------------------------------
-- 6. STAFF FUNCTION (one entry point; staff-only; row-locked)
--    actions: confirm | complete | cancel | verify | unverify | reject_payment | notes | archive | restore | delete
--    Returns the old proof path (only for "delete"/replaced proofs) so the API can remove the file.
-- ---------------------------------------------------------------------
create or replace function public.staff_action(p_id bigint, p_action text, p_text text default null)
returns text language plpgsql security definer set search_path = public as
$$
declare r public.reservations; p public.payments; old_path text;
begin
  if auth.uid() is null then perform public.fail('not_signed_in'); end if;
  if not public.is_staff() then perform public.fail('forbidden'); end if;
  select * into r from public.reservations where id = p_id for update;
  if not found then perform public.fail('not_found'); end if;
  select * into p from public.payments where reservation_id = p_id for update;

  case p_action
    when 'confirm' then
      if r.status <> 'pending' then perform public.fail('bad_transition'); end if;
      if p.status is distinct from 'verified' then perform public.fail('payment_not_verified'); end if;
      update public.reservations set status = 'confirmed' where id = p_id;
    when 'complete' then
      if r.status <> 'confirmed' then perform public.fail('bad_transition'); end if;
      update public.reservations set status = 'completed' where id = p_id;
    when 'cancel' then
      if r.status not in ('pending', 'confirmed') then perform public.fail('bad_transition'); end if;
      update public.reservations set status = 'cancelled' where id = p_id;
    when 'verify' then
      if p.status is distinct from 'proof_submitted' then perform public.fail('no_proof'); end if;
      if r.status not in ('pending', 'confirmed') then perform public.fail('bad_transition'); end if;
      update public.payments set status = 'verified', verified_by = auth.uid(), verified_at = now(), rejection_reason = null
       where id = p.id;
    when 'reject_payment' then
      if p.status is distinct from 'proof_submitted' then perform public.fail('no_proof'); end if;
      if r.status <> 'pending' then perform public.fail('bad_transition'); end if;
      update public.payments set status = 'rejected', verified_by = auth.uid(), verified_at = now(),
             rejection_reason = left(nullif(trim(coalesce(p_text, '')), ''), 300)
       where id = p.id;
    when 'unverify' then
      if p.status is distinct from 'verified' or r.status <> 'pending' then perform public.fail('bad_transition'); end if;
      update public.payments set status = 'proof_submitted', verified_by = null, verified_at = null where id = p.id;
    when 'notes' then
      update public.reservations set admin_notes = left(nullif(trim(coalesce(p_text, '')), ''), 500) where id = p_id;
    when 'archive' then
      if r.archived_at is not null then perform public.fail('already_archived'); end if;
      if r.status not in ('completed', 'cancelled') then perform public.fail('not_finished'); end if;
      update public.reservations set archived_at = now() where id = p_id;
    when 'restore' then
      if r.archived_at is null then perform public.fail('not_archived'); end if;
      update public.reservations set archived_at = null where id = p_id;
    when 'delete' then
      if r.archived_at is null then perform public.fail('not_archived'); end if;
      old_path := p.proof_path;
      delete from public.reservations where id = p_id;   -- the payment row goes with it (ON DELETE CASCADE)
      return old_path;
    else
      perform public.fail('bad_action');
  end case;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 7. READ VIEW (security_invoker: the caller's RLS decides which rows they see)
-- ---------------------------------------------------------------------
create or replace view public.reservation_details with (security_invoker = true) as
select r.id, 'SC-' || lpad(r.id::text, 5, '0') as reference, r.user_id,
       r.branch, b.name as branch_name,
       r.reservation_date, to_char(r.reservation_time, 'HH24:MI') as reservation_time,
       r.guests, r.occasion, r.special_requests, r.status, r.admin_notes,
       r.created_at, r.updated_at, r.archived_at,
       c.full_name as customer_name, c.phone, c.email,
       p.payment_option, p.method as payment_method, p.total_amount, p.amount_due,
       (p.total_amount - p.amount_due) as balance,
       p.reference_number as payment_reference, p.proof_original_name as proof_name,
       (p.proof_path is not null) as has_proof, p.status as payment_status, p.rejection_reason,
       p.verified_at, v.full_name as verified_by_name
from public.reservations r
join public.branches b on b.code = r.branch
join public.profiles c on c.id = r.user_id
left join public.payments p on p.reservation_id = r.id
left join public.profiles v on v.id = p.verified_by;

-- The proof file path is needed only by the API (to sign a short-lived link for STAFF). Staff only.
create or replace function public.staff_proof_path(p_id bigint) returns text
language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.is_staff() then perform public.fail('forbidden'); end if;
  return (select proof_path from public.payments where reservation_id = p_id);
end $$;

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.branches      enable row level security;
alter table public.cafe_settings enable row level security;
alter table public.reservations  enable row level security;
alter table public.payments      enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select to anon, authenticated using (active);

drop policy if exists settings_read on public.cafe_settings;
create policy settings_read on public.cafe_settings for select to anon, authenticated using (true);

drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.is_staff()
         or exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));
-- No INSERT / UPDATE / DELETE policies on reservations or payments: only the functions above can write.

-- ---------------------------------------------------------------------
-- 9. PRIVILEGES (least privilege)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.branches, public.cafe_settings to anon, authenticated;
grant select on public.profiles, public.reservations, public.payments, public.reservation_details to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

grant execute on function public.slot_availability(text, date) to authenticated;
grant execute on function public.create_reservation(text, date, time, integer, text, text, text, text, text, text) to authenticated;
grant execute on function public.customer_cancel(bigint) to authenticated;
grant execute on function public.customer_submit_proof(bigint, text, text, text) to authenticated;
grant execute on function public.staff_action(bigint, text, text) to authenticated;
grant execute on function public.staff_proof_path(bigint) to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.setting_int(text) to anon, authenticated;
grant execute on function public.slot_start(date, time) to authenticated;
-- (service_role keeps full access by default; the Node API uses it ONLY for Storage.)

-- ---------------------------------------------------------------------
-- 10. STORAGE: a PRIVATE bucket for payment proofs (3 MB; PNG, JPG or PDF).
--     No storage policies are created on purpose: browsers cannot list or read proofs.
--     Uploads use one-time signed URLs made by the API; staff view proofs through short-lived signed links.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-proofs', 'payment-proofs', false, 3145728, array['image/png', 'image/jpeg', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 3145728,
      allowed_mime_types = array['image/png', 'image/jpeg', 'application/pdf'];
  end if;
end $$;
