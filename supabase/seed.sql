-- =====================================================================
-- DEVELOPMENT / DEMO DATA ONLY. NEVER run this on the live (production) database.
-- Run AFTER schema.sql, and after you have registered at least one customer account on the website.
-- It adds 3 sample reservations for the FIRST customer found. It creates no users and contains no passwords.
-- =====================================================================
do $$
declare uid uuid; d date := (now() at time zone 'Asia/Manila')::date;
begin
  select id into uid from public.profiles where role = 'customer' order by created_at limit 1;
  if uid is null then raise notice 'Register a customer on the website first, then run this file again.'; return; end if;

  insert into public.reservations (user_id, branch, reservation_date, reservation_time, guests, occasion, status) values
    (uid, 'calamba', d + 5, '12:00', 4, 'Sample: birthday',     'pending'),
    (uid, 'cabuyao', d + 7, '15:00', 6, 'Sample: team lunch',   'confirmed'),
    (uid, 'calamba', d - 10, '18:00', 2, 'Sample: past visit',  'completed')   -- a past date is fine for a direct insert
  on conflict do nothing;

  insert into public.payments (reservation_id, payment_option, total_amount, amount_due, status)
  select r.id, 'downpayment', r.guests * 200, ceil(r.guests * 200 * 0.3), 'unpaid'
    from public.reservations r where r.user_id = uid and r.occasion like 'Sample:%'
      and not exists (select 1 from public.payments p where p.reservation_id = r.id);
end $$;
