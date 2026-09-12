-- LEAN — σχήμα βάσης για Supabase
-- Τρέξε το ολόκληρο στο SQL Editor του project σου.

create table if not exists public.lean_sessions (
  id         uuid primary key,
  date       date not null,
  day        text not null check (day in ('A', 'B', 'C')),
  entries    jsonb not null default '{}'::jsonb,
  done       boolean not null default false,
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lean_bodyweight (
  id         uuid primary key,
  date       date not null,
  kg         numeric(5,1) not null check (kg > 20 and kg < 400),
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lean_measurements (
  id         uuid primary key,
  date       date not null,
  shoulders  numeric(5,1) not null check (shoulders > 0),
  waist      numeric(5,1) not null check (waist > 0),
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists lean_sessions_date_idx     on public.lean_sessions (date desc);
create index if not exists lean_bodyweight_date_idx   on public.lean_bodyweight (date desc);
create index if not exists lean_measurements_date_idx on public.lean_measurements (date desc);

-- Κρατάει το updated_at ενημερωμένο σε κάθε upsert.
create or replace function public.lean_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists lean_sessions_touch     on public.lean_sessions;
drop trigger if exists lean_bodyweight_touch   on public.lean_bodyweight;
drop trigger if exists lean_measurements_touch on public.lean_measurements;

create trigger lean_sessions_touch     before update on public.lean_sessions     for each row execute function public.lean_touch_updated_at();
create trigger lean_bodyweight_touch   before update on public.lean_bodyweight   for each row execute function public.lean_touch_updated_at();
create trigger lean_measurements_touch before update on public.lean_measurements for each row execute function public.lean_touch_updated_at();

alter table public.lean_sessions     enable row level security;
alter table public.lean_bodyweight   enable row level security;
alter table public.lean_measurements enable row level security;

-- ---------------------------------------------------------------------------
-- ΠΡΟΣΟΧΗ — ΓΡΗΓΟΡΗ ΕΚΚΙΝΗΣΗ, ΧΩΡΙΣ ΣΥΝΔΕΣΗ ΧΡΗΣΤΗ
--
-- Οι παρακάτω πολιτικές επιτρέπουν σε οποιονδήποτε έχει το URL και το anon
-- key να διαβάσει και να γράψει. Επειδή το anon key ταξιδεύει μέσα στη
-- σελίδα, αυτό σημαίνει ότι όποιος ανοίξει τα developer tools στο δικό σου
-- site μπορεί να δει τα δεδομένα σου.
--
-- Είναι αποδεκτό μόνο για ένα προσωπικό project που δεν μοιράζεσαι.
-- Μόλις το site γίνει δημόσιο, σβήσε αυτές τις τέσσερις πολιτικές ανά πίνακα
-- και ενεργοποίησε το μπλοκ με το auth.uid() παρακάτω.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lean_sessions', 'lean_bodyweight', 'lean_measurements'] loop
    execute format('drop policy if exists lean_open_all on public.%I', t);
    execute format(
      'create policy lean_open_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ΠΑΡΑΓΩΓΗ — ΜΕ ΣΥΝΔΕΣΗ ΧΡΗΣΤΗ
-- Αφαίρεσε τα σχόλια αφού προσθέσεις Supabase Auth στην εφαρμογή.
-- ---------------------------------------------------------------------------

-- do $$
-- declare t text;
-- begin
--   foreach t in array array['lean_sessions', 'lean_bodyweight', 'lean_measurements'] loop
--     execute format('drop policy if exists lean_open_all on public.%I', t);
--     execute format(
--       'create policy lean_own_rows on public.%I for all to authenticated
--        using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
--   end loop;
-- end $$;
