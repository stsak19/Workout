/* Αποθήκευση και αυτόματος συγχρονισμός.
 *
 * Κάθε εγγραφή πάει πρώτα στη συσκευή (localStorage, με εφεδρεία μνήμης
 * αν ο browser το μπλοκάρει) και αμέσως μετά ανεβαίνει μόνη της στο cloud.
 * Δεν υπάρχει τίποτα να ρυθμίσει ο χρήστης — τα στοιχεία σύνδεσης είναι
 * ενσωματωμένα εδώ.
 *
 * Σύγκρουση εκδόσεων: κάθε γραμμή κρατάει updated_at. Στο ανακάτεμα
 * τοπικών και απομακρυσμένων δεδομένων κερδίζει η πιο πρόσφατη.
 */

const PREFIX = 'lean.';

const SUPABASE_URL = 'https://sdddhzrbqkfayodyjnnz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Pz_tirRe8zJ2JZV6VC4K1g_TNyp_nDe';

const TABLES = {
  sessions: 'lean_sessions',
  bodyweight: 'lean_bodyweight',
  measurements: 'lean_measurements'
};

const PROFILE_TABLE = 'lean_profile';
const PROFILE_ID = 'me';
const PLAN_ID = 'plan';

/* Κλειδιά που ζουν ως μία γραμμή στον πίνακα lean_profile. */
const SINGLE = { profile: PROFILE_ID, plan: PLAN_ID };

const SYNCED = [...Object.keys(TABLES), 'profile', 'plan'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- Τοπική αποθήκευση ---------- */

const memory = new Map();
let usingMemory = false;

function probe() {
  try {
    const k = PREFIX + '__probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const hasLocal = probe();
if (!hasLocal) usingMemory = true;

export const storageMode = () => (usingMemory ? 'memory' : 'local');

export function read(key, fallback) {
  const full = PREFIX + key;
  try {
    const raw = hasLocal ? window.localStorage.getItem(full) : memory.get(full);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeRaw(key, value) {
  const full = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (hasLocal) window.localStorage.setItem(full, raw);
    else memory.set(full, raw);
  } catch {
    usingMemory = true;
    memory.set(full, raw);
  }
}

/* Αφαιρεί τη σφραγίδα χρόνου, για να συγκρίνουμε μόνο το περιεχόμενο. */
function bare(row) {
  if (!row || typeof row !== 'object') return JSON.stringify(row);
  const copy = {};
  Object.keys(row)
    .filter((k) => k !== 'updated_at' && k !== 'user_id')
    .sort()
    .forEach((k) => { copy[k] = row[k]; });
  return JSON.stringify(copy);
}

/* Σφραγίζει με updated_at μόνο ό,τι όντως άλλαξε. */
function stamp(key, value) {
  const now = new Date().toISOString();

  if (SINGLE[key]) {
    if (!value || typeof value !== 'object') return value;
    const prev = read(key, null);
    const unchanged = prev && bare(prev) === bare(value);
    return { ...value, updated_at: unchanged ? prev.updated_at || now : now };
  }

  if (!TABLES[key] || !Array.isArray(value)) return value;
  const prev = new Map((read(key, []) || []).filter(Boolean).map((r) => [r.id, r]));
  return value.map((row) => {
    const old = prev.get(row.id);
    const unchanged = old && bare(old) === bare(row);
    return { ...row, updated_at: unchanged ? old.updated_at || now : now };
  });
}

export function write(key, value) {
  writeRaw(key, stamp(key, value));
  queuePush(key);
  return value;
}

export async function clearAll() {
  ['sessions', 'bodyweight', 'measurements', 'profile', 'plan', 'settings'].forEach((k) => {
    const full = PREFIX + k;
    try {
      if (hasLocal) window.localStorage.removeItem(full);
    } catch { /* αγνόησε */ }
    memory.delete(full);
  });
  /* Αλλιώς ο επόμενος συγχρονισμός θα τα κατέβαζε πάλι όλα. */
  try {
    const sb = await getClient();
    for (const table of Object.values(TABLES)) {
      await sb.from(table).delete().not('id', 'is', null);
    }
    await sb.from(PROFILE_TABLE).delete().not('id', 'is', null);
    emit('ok');
  } catch (err) {
    emit('error', message(err));
  }
}

export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    sessions: read('sessions', []),
    bodyweight: read('bodyweight', []),
    measurements: read('measurements', []),
    profile: read('profile', null),
    plan: read('plan', null)
  };
}

export function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Άκυρο αρχείο');
  if (Array.isArray(payload.sessions)) write('sessions', payload.sessions);
  if (Array.isArray(payload.bodyweight)) write('bodyweight', payload.bodyweight);
  if (Array.isArray(payload.measurements)) write('measurements', payload.measurements);
  if (payload.profile) write('profile', payload.profile);
  if (payload.plan) write('plan', payload.plan);
}

/* ---------- Κατάσταση συγχρονισμού ---------- */

const sync = { status: 'idle', message: '', at: null, running: false };
const pending = new Set();
let pushTimer = null;

export const syncState = () => ({
  status: sync.status,
  message: sync.message,
  at: sync.at,
  pending: pending.size
});

function emit(status, msg) {
  sync.status = status;
  sync.message = msg || '';
  if (status === 'ok') sync.at = new Date().toISOString();
  window.dispatchEvent(new CustomEvent('lean:sync', { detail: syncState() }));
}

const message = (err) => (err && err.message ? err.message : String(err));

/* ---------- Πελάτης Supabase ---------- */

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY))
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

/* ---------- Ανέβασμα ---------- */

function rowsFor(key) {
  return (read(key, []) || []).filter((r) => r && UUID_RE.test(String(r.id)));
}

async function pushKey(sb, key) {
  if (SINGLE[key]) {
    const p = read(key, null);
    if (!p) return;
    const { updated_at, ...data } = p;
    const { error } = await sb
      .from(PROFILE_TABLE)
      .upsert({ id: SINGLE[key], data, updated_at: updated_at || new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return;
  }
  const rows = rowsFor(key);
  if (!rows.length) return;
  const { error } = await sb.from(TABLES[key]).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

function queuePush(key) {
  if (!SYNCED.includes(key)) return;
  pending.add(key);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPush, 1200);
}

async function flushPush() {
  if (!pending.size || sync.running) return;
  const keys = [...pending];
  sync.running = true;
  emit('syncing');
  try {
    const sb = await getClient();
    for (const key of keys) await pushKey(sb, key);
    keys.forEach((k) => pending.delete(k));
    emit('ok');
  } catch (err) {
    emit('error', message(err));
  } finally {
    sync.running = false;
  }
}

/* ---------- Κατέβασμα και ανακάτεμα ---------- */

const stampOf = (row) => (row && row.updated_at ? Date.parse(row.updated_at) || 0 : 0);

function clean(key, row) {
  const { user_id, ...rest } = row;
  if (key === 'bodyweight') rest.kg = Number(rest.kg);
  if (key === 'measurements') {
    rest.shoulders = Number(rest.shoulders);
    rest.waist = Number(rest.waist);
  }
  return rest;
}

function merge(key, local, remote) {
  const map = new Map();
  (local || []).filter(Boolean).forEach((r) => map.set(r.id, r));
  let changed = false;
  (remote || []).filter(Boolean).forEach((raw) => {
    const row = clean(key, raw);
    const mine = map.get(row.id);
    if (!mine || stampOf(row) > stampOf(mine)) {
      map.set(row.id, row);
      changed = true;
    }
  });
  return { rows: [...map.values()], changed };
}

async function pullAll(sb) {
  let changed = false;

  for (const [key, table] of Object.entries(TABLES)) {
    const { data, error } = await sb.from(table).select('*');
    if (error) throw new Error(error.message);
    const result = merge(key, read(key, []), data);
    if (result.changed) {
      writeRaw(key, result.rows);
      changed = true;
    }
  }

  const { data, error } = await sb.from(PROFILE_TABLE).select('*');
  if (error) throw new Error(error.message);
  const byId = new Map((data || []).filter(Boolean).map((r) => [r.id, r]));

  for (const [key, id] of Object.entries(SINGLE)) {
    const row = byId.get(id);
    if (!row || !row.data) continue;
    const remote = { ...row.data, updated_at: row.updated_at };
    const mine = read(key, null);
    if (!mine || stampOf(remote) > stampOf(mine)) {
      writeRaw(key, remote);
      changed = true;
    }
  }

  return changed;
}

/* Πλήρης γύρος: κατέβασμα, ανακάτεμα, ανέβασμα. */
export async function syncNow() {
  if (sync.running) return false;
  sync.running = true;
  emit('syncing');
  let changed = false;
  try {
    const sb = await getClient();
    changed = await pullAll(sb);
    for (const key of SYNCED) await pushKey(sb, key);
    pending.clear();
    emit('ok');
    if (changed) window.dispatchEvent(new CustomEvent('lean:data'));
  } catch (err) {
    emit('error', message(err));
  } finally {
    sync.running = false;
  }
  return changed;
}

/* ---------- Αυτόματες αφορμές ---------- */

window.addEventListener('online', () => syncNow());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});

/* Ξαναδοκίμασε ό,τι έμεινε πίσω, κάθε δύο λεπτά. */
setInterval(() => {
  if (pending.size) flushPush();
}, 120000);
