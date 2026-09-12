/* Αποθήκευση.
 *
 * Προεπιλογή: localStorage στη συσκευή. Αν ο browser το μπλοκάρει
 * (π.χ. σε ενσωματωμένη προεπισκόπηση), πέφτει σε μνήμη ώστε η
 * εφαρμογή να δουλεύει κανονικά μέσα στη συνεδρία.
 *
 * Προαιρετικά: αν συμπληρωθούν στοιχεία Supabase στις Ρυθμίσεις,
 * κάθε εγγραφή συγχρονίζεται και στο cloud.
 */

const PREFIX = 'lean.';
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
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  const full = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (hasLocal) window.localStorage.setItem(full, raw);
    else memory.set(full, raw);
  } catch {
    usingMemory = true;
    memory.set(full, raw);
  }
  queueSync(key, value);
  return value;
}

export function clearAll() {
  const keys = ['sessions', 'bodyweight', 'measurements', 'profile', 'settings'];
  keys.forEach((k) => {
    const full = PREFIX + k;
    try {
      if (hasLocal) window.localStorage.removeItem(full);
    } catch { /* αγνόησε */ }
    memory.delete(full);
  });
}

export function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    sessions: read('sessions', []),
    bodyweight: read('bodyweight', []),
    measurements: read('measurements', []),
    profile: read('profile', null)
  };
}

export function importAll(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Άκυρο αρχείο');
  if (Array.isArray(payload.sessions)) write('sessions', payload.sessions);
  if (Array.isArray(payload.bodyweight)) write('bodyweight', payload.bodyweight);
  if (Array.isArray(payload.measurements)) write('measurements', payload.measurements);
  if (payload.profile) write('profile', payload.profile);
}

/* ---------- Προαιρετικό Supabase ---------- */

let client = null;
let clientKey = '';
const SYNCED = {
  sessions: 'lean_sessions',
  bodyweight: 'lean_bodyweight',
  measurements: 'lean_measurements'
};

export function supabaseConfig() {
  return read('settings', {});
}

export async function getClient() {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.anonKey) return null;
  const signature = cfg.url + '|' + cfg.anonKey;
  if (client && clientKey === signature) return client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(cfg.url, cfg.anonKey);
  clientKey = signature;
  return client;
}

export async function testConnection() {
  const sb = await getClient();
  if (!sb) throw new Error('Συμπλήρωσε πρώτα URL και anon key.');
  const { error } = await sb.from('lean_sessions').select('id').limit(1);
  if (error) throw new Error(error.message);
  return true;
}

let syncTimer = null;
const pending = new Set();

function queueSync(key, value) {
  if (!SYNCED[key]) return;
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.anonKey) return;
  pending.add(key);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 1200);
}

async function flushSync() {
  const keys = [...pending];
  pending.clear();
  let sb;
  try {
    sb = await getClient();
  } catch {
    return;
  }
  if (!sb) return;
  for (const key of keys) {
    const rows = read(key, []);
    if (!Array.isArray(rows) || !rows.length) continue;
    try {
      await sb.from(SYNCED[key]).upsert(rows, { onConflict: 'id' });
      window.dispatchEvent(new CustomEvent('lean:sync', { detail: { key, ok: true } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('lean:sync', { detail: { key, ok: false, error: String(err) } }));
    }
  }
}

export async function pullFromCloud() {
  const sb = await getClient();
  if (!sb) throw new Error('Δεν έχει ρυθμιστεί Supabase.');
  for (const [key, table] of Object.entries(SYNCED)) {
    const { data, error } = await sb.from(table).select('*');
    if (error) throw new Error(error.message);
    if (Array.isArray(data) && data.length) {
      const full = PREFIX + key;
      const raw = JSON.stringify(data);
      if (hasLocal) window.localStorage.setItem(full, raw);
      else memory.set(full, raw);
    }
  }
  return true;
}
