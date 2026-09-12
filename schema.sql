-- LEAN — σχήμα βάσης για Supabase
-- Τρέξε το ολόκληρο στο SQL Editor του project σου.

create table if not exists public.sessions (
  id         uuid primary key,
  date       date not null,
  day        text not null check (day in ('A', 'B', 'C')),
  entries    jsonb not null default '{}'::jsonb,
  done       boolean not null default false,
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bodyweight (
  id         uuid primary key,
  date       date not null,
  kg         numeric(5,1) not null check (kg > 20 and kg < 400),
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.measurements (
  id         uuid primary key,
  date       date not null,
  shoulders  numeric(5,1) not null check (shoulders > 0),
  waist      numeric(5,1) not null check (waist > 0),
  user_id    uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_date_idx     on public.sessions (date desc);
create index if not exists bodyweight_date_idx   on public.bodyweight (date desc);
create index if not exists measurements_date_idx on public.measurements (date desc);

-- Κρατάει το updated_at ενημερωμένο σε κάθε upsert.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists sessions_touch     on public.sessions;
drop trigger if exists bodyweight_touch   on public.bodyweight;
drop trigger if exists measurements_touch on public.measurements;

create trigger sessions_touch     before update on public.sessions     for each row execute function public.touch_updated_at();
create trigger bodyweight_touch   before update on public.bodyweight   for each row execute function public.touch_updated_at();
create trigger measurements_touch before update on public.measurements for each row execute function public.touch_updated_at();

alter table public.sessions     enable row level security;
alter table public.bodyweight   enable row level security;
alter table public.measurements enable row level security;

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
  foreach t in array array['sessions', 'bodyweight', 'measurements'] loop
    execute format('drop policy if exists open_all on public.%I', t);
    execute format(
      'create policy open_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ΠΑΡΑΓΩΓΗ — ΜΕ ΣΥΝΔΕΣΗ ΧΡΗΣΤΗ
-- Αφαίρεσε τα σχόλια αφού προσθέσεις Supabase Auth στην εφαρμογή.
-- ---------------------------------------------------------------------------

-- do $$
-- declare t text;
-- begin
--   foreach t in array array['sessions', 'bodyweight', 'measurements'] loop
--     execute format('drop policy if exists open_all on public.%I', t);
--     execute format(
--       'create policy own_rows on public.%I for all to authenticated
--        using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
--   end loop;
-- end $$;
