import { PROGRAM, DAY_ORDER, WEEKLY_VOLUME, NUTRITION, GUIDE } from './data.js';
import * as store from './storage.js';
import { lineChart, barRow } from './charts.js';

/* ---------- Βοηθητικά ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Το cloud θέλει κανονικά uuid, οπότε η εφεδρεία φτιάχνει κι αυτή uuid v4. */
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const today = () => new Date().toISOString().slice(0, 10);

const shortDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
};

const num = (n, dp = 1) =>
  Number(n).toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: dp });

/* Epley: εκτιμώμενο 1RM. Χρήσιμο για να συγκρίνεις σετ με διαφορετικές επαναλήψεις. */
const e1rm = (w, r) => (w > 0 ? w * (1 + r / 30) : 0);

const ALL_EXERCISES = DAY_ORDER.flatMap((d) =>
  PROGRAM[d].exercises.map((ex) => ({ ...ex, day: d }))
);

const exById = (id) => ALL_EXERCISES.find((e) => e.id === id);

/* ---------- Κατάσταση ---------- */

const state = {
  view: 'train',
  day: 'A',
  editing: null,
  sessions: store.read('sessions', []),
  bodyweight: store.read('bodyweight', []),
  measurements: store.read('measurements', []),
  profile: store.read('profile', null)
};

const save = (key) => store.write(key, state[key]);

/* ---------- Συνεδρίες ---------- */

function sessionFor(date, day) {
  return state.sessions.find((s) => s.date === date && s.day === day);
}

function ensureSession(date, day) {
  let s = sessionFor(date, day);
  if (!s) {
    s = { id: uid(), date, day, entries: {}, done: false };
    state.sessions.push(s);
  }
  return s;
}

const sortedSessions = () => [...state.sessions].sort((a, b) => a.date.localeCompare(b.date));

/* Τελευταία φορά που έγινε η άσκηση, εξαιρώντας τη σημερινή εγγραφή. */
function lastPerformance(exId) {
  const past = sortedSessions().filter((s) => s.date !== today());
  for (let i = past.length - 1; i >= 0; i--) {
    const sets = past[i].entries[exId];
    if (sets && sets.some((x) => x && x.w != null)) {
      return { date: past[i].date, sets: sets.filter(Boolean) };
    }
  }
  return null;
}

/* Διπλή προοδευτικότητα: αν όλα τα σετ έπιασαν το πάνω όριο, ανέβασε βάρος. */
function suggestion(ex) {
  const last = lastPerformance(ex.id);
  if (!last) return { weight: null, levelUp: false };
  const complete = last.sets.length >= ex.sets;
  const allTop = last.sets.every((s) => s.r >= ex.repMax);
  const topWeight = Math.max(...last.sets.map((s) => s.w));
  if (complete && allTop) return { weight: +(topWeight + ex.step).toFixed(2), levelUp: true };
  return { weight: topWeight, levelUp: false };
}

/* Ποια ημέρα προτείνεται σήμερα: η επόμενη στη ρότα μετά την τελευταία ολοκληρωμένη. */
function suggestedDay() {
  const done = sortedSessions().filter((s) => s.done);
  if (!done.length) return 'A';
  const lastDay = done[done.length - 1].day;
  return DAY_ORDER[(DAY_ORDER.indexOf(lastDay) + 1) % DAY_ORDER.length];
}

function weekNumber() {
  const done = sortedSessions().filter((s) => s.done);
  if (!done.length) return null;
  const first = new Date(done[0].date + 'T00:00:00');
  const diff = Date.now() - first.getTime();
  return Math.floor(diff / (7 * 864e5)) + 1;
}

/* ---------- Απόδοση: κεφαλίδα ---------- */

function renderMasthead() {
  const wk = weekNumber();
  const doneCount = state.sessions.filter((s) => s.done).length;
  if (wk == null) {
    $('#week-count').textContent = '0';
    $('#week-label').textContent = 'προπονήσεις';
  } else {
    $('#week-count').textContent = 'Εβδ. ' + wk;
    $('#week-label').textContent = doneCount + (doneCount === 1 ? ' προπόνηση' : ' προπονήσεις');
  }
}

/* ---------- Απόδοση: προπόνηση ---------- */

function renderDaystrip() {
  const strip = $('#daystrip');
  strip.innerHTML = '';
  DAY_ORDER.forEach((d) => {
    const day = PROGRAM[d];
    const s = sessionFor(today(), d);
    const btn = document.createElement('button');
    btn.className = 'daybtn';
    btn.setAttribute('aria-pressed', String(state.day === d));
    btn.innerHTML =
      `<span class="letter">${day.letter}${s && s.done ? '<span class="done"></span>' : ''}</span>` +
      `<span class="meta">${day.focus.split(' · ')[0]}</span>`;
    btn.addEventListener('click', () => {
      state.day = d;
      state.editing = null;
      renderTrain();
    });
    strip.appendChild(btn);
  });
}

function renderTrain() {
  renderDaystrip();
  const day = PROGRAM[state.day];
  $('#day-title').textContent = day.name;
  $('#day-focus').textContent = day.focus;

  const list = $('#exercise-list');
  list.innerHTML = '';
  const session = sessionFor(today(), state.day);

  day.exercises.forEach((ex) => {
    const entries = (session && session.entries[ex.id]) || [];
    const filled = entries.filter(Boolean);
    const sug = suggestion(ex);
    const last = lastPerformance(ex.id);

    const card = document.createElement('article');
    card.className = 'exercise' + (ex.key ? ' ex-key' : '');

    const allDone = filled.length >= ex.sets;
    const allTop = allDone && filled.every((s) => s.r >= ex.repMax);
    card.dataset.state = allTop ? 'levelup' : allDone ? 'done' : 'open';

    const head = document.createElement('div');
    head.className = 'ex-top';
    head.innerHTML =
      `<div><h3 class="ex-name">${ex.name}</h3>` +
      `<div class="ex-prescription">${ex.sets} × ${ex.repMin}–${ex.repMax}` +
      (ex.rir !== '—' ? ` · RIR ${ex.rir}` : '') + `</div></div>` +
      `<span class="ex-group">${ex.group}</span>`;
    card.appendChild(head);

    const sets = document.createElement('div');
    sets.className = 'sets';
    for (let i = 0; i < ex.sets; i++) {
      const entry = entries[i];
      const chip = document.createElement('button');
      chip.className = 'setchip';
      chip.dataset.filled = String(!!entry);
      chip.dataset.top = String(!!entry && entry.r >= ex.repMax);
      chip.setAttribute('aria-label', `Σετ ${i + 1}`);
      chip.innerHTML = entry
        ? `<span class="val">${num(entry.w)}${ex.bodyweight ? '' : ' kg'}</span><span class="sub">${entry.r} επαν.</span>`
        : `<span class="val">—</span><span class="sub">σετ ${i + 1}</span>`;
      chip.addEventListener('click', () => {
        state.editing =
          state.editing && state.editing.exId === ex.id && state.editing.index === i
            ? null
            : { exId: ex.id, index: i };
        renderTrain();
      });
      sets.appendChild(chip);
    }
    card.appendChild(sets);

    if (last) {
      const meta = document.createElement('div');
      meta.className = 'ex-last';
      meta.textContent =
        `Τελευταία (${shortDate(last.date)}): ` +
        last.sets.map((s) => `${num(s.w)}×${s.r}`).join('  ·  ');
      card.appendChild(meta);
    }

    if (allTop) {
      const note = document.createElement('div');
      note.className = 'levelup-note';
      const next = +(Math.max(...filled.map((s) => s.w)) + ex.step).toFixed(2);
      note.textContent = `Κλείδωσες όλα τα σετ στο πάνω όριο. Την επόμενη φορά ανέβα στα ${num(next)} kg.`;
      card.appendChild(note);
    } else if (sug.levelUp) {
      const note = document.createElement('div');
      note.className = 'levelup-note';
      note.textContent = `Σήμερα ανέβα στα ${num(sug.weight)} kg.`;
      card.appendChild(note);
    }

    if (state.editing && state.editing.exId === ex.id) {
      card.appendChild(buildEditor(ex, state.editing.index, entries, sug));
    }

    list.appendChild(card);
  });

  const finish = $('#finish-session');
  finish.textContent =
    session && session.done ? 'Η προπόνηση είναι κλεισμένη' : 'Κλείσε τη σημερινή προπόνηση';
  finish.disabled = !!(session && session.done);
}

function buildEditor(ex, index, entries, sug) {
  const existing = entries[index];
  const prev = entries.slice(0, index).filter(Boolean).pop();
  const startW = existing ? existing.w : prev ? prev.w : sug.weight != null ? sug.weight : 0;
  const startR = existing ? existing.r : Math.round((ex.repMin + ex.repMax) / 2);

  const box = document.createElement('div');
  box.className = 'editor';
  box.innerHTML = `
    <div class="editor-grid">
      <div class="field">
        <label for="ed-w">${ex.bodyweight ? 'Επιβάρυνση (kg)' : 'Κιλά'}</label>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="Μείωση κιλών">−</button>
          <input id="ed-w" type="number" inputmode="decimal" step="${ex.step}" min="0" value="${startW}">
          <button type="button" data-step="1" aria-label="Αύξηση κιλών">+</button>
        </div>
      </div>
      <div class="field">
        <label for="ed-r">Επαναλήψεις</label>
        <div class="stepper">
          <button type="button" data-rep="-1" aria-label="Μείωση επαναλήψεων">−</button>
          <input id="ed-r" type="number" inputmode="numeric" step="1" min="1" value="${startR}">
          <button type="button" data-rep="1" aria-label="Αύξηση επαναλήψεων">+</button>
        </div>
      </div>
    </div>
    <div class="editor-actions">
      <button class="btn btn-primary" data-save>Καταχώρηση σετ ${index + 1}</button>
      ${existing ? '<button class="btn btn-quiet" data-clear>Σβήσε</button>' : ''}
    </div>`;

  const wInput = $('#ed-w', box);
  const rInput = $('#ed-r', box);

  $$('[data-step]', box).forEach((b) =>
    b.addEventListener('click', () => {
      const d = Number(b.dataset.step) * ex.step;
      wInput.value = Math.max(0, +(Number(wInput.value || 0) + d).toFixed(2));
    })
  );
  $$('[data-rep]', box).forEach((b) =>
    b.addEventListener('click', () => {
      rInput.value = Math.max(1, Number(rInput.value || 0) + Number(b.dataset.rep));
    })
  );

  $('[data-save]', box).addEventListener('click', () => {
    const w = Number(wInput.value);
    const r = Number(rInput.value);
    if (!Number.isFinite(w) || w < 0 || !Number.isFinite(r) || r < 1) return;
    const session = ensureSession(today(), state.day);
    if (!session.entries[ex.id]) session.entries[ex.id] = [];
    session.entries[ex.id][index] = { w, r };
    save('sessions');
    state.editing = null;
    startTimer(ex.rest, ex.name);
    renderTrain();
    renderMasthead();
  });

  const clearBtn = $('[data-clear]', box);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const session = sessionFor(today(), state.day);
      if (session && session.entries[ex.id]) {
        session.entries[ex.id][index] = null;
        if (session.entries[ex.id].every((x) => !x)) delete session.entries[ex.id];
        save('sessions');
      }
      state.editing = null;
      renderTrain();
    });
  }

  setTimeout(() => wInput.focus({ preventScroll: true }), 30);
  return box;
}

$('#finish-session').addEventListener('click', () => {
  const session = sessionFor(today(), state.day);
  if (!session || !Object.keys(session.entries).length) {
    alert('Καταχώρησε τουλάχιστον ένα σετ πριν κλείσεις την προπόνηση.');
    return;
  }
  session.done = true;
  save('sessions');
  stopTimer();
  renderTrain();
  renderMasthead();
  renderProgress();
});

/* ---------- Χρονόμετρο ξεκούρασης ---------- */

let timerId = null;
let timerLeft = 0;
let timerTotal = 0;

function startTimer(seconds, label) {
  stopTimer();
  timerTotal = seconds;
  timerLeft = seconds;
  $('#timer').hidden = false;
  $('#timer-label').textContent = 'Ξεκούραση · ' + label;
  paintTimer();
  timerId = setInterval(() => {
    timerLeft--;
    if (timerLeft <= 0) {
      if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
      stopTimer();
      return;
    }
    paintTimer();
  }, 1000);
}

function paintTimer() {
  const m = Math.floor(timerLeft / 60);
  const s = String(timerLeft % 60).padStart(2, '0');
  $('#timer-count').textContent = `${m}:${s}`;
  $('#timer-bar').style.width = (timerLeft / timerTotal) * 100 + '%';
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
  $('#timer').hidden = true;
}

$('#timer-skip').addEventListener('click', stopTimer);

/* ---------- Απόδοση: πρόοδος ---------- */

function renderProgress() {
  renderExercisePicker();
  renderExerciseChart();
  renderBodyweight();
  renderRatio();
  renderVolume();
  renderHistory();
}

function renderExercisePicker() {
  const sel = $('#progress-exercise');
  const current = sel.value;
  sel.innerHTML = '';
  const seen = new Set();
  ALL_EXERCISES.forEach((ex) => {
    if (seen.has(ex.name)) return;
    seen.add(ex.name);
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

$('#progress-exercise').addEventListener('change', renderExerciseChart);

function renderExerciseChart() {
  const exId = $('#progress-exercise').value || ALL_EXERCISES[0].id;
  const ex = exById(exId);
  const host = $('#exercise-chart');
  const stats = $('#exercise-stats');
  host.innerHTML = '';
  stats.innerHTML = '';

  const points = sortedSessions()
    .map((s) => {
      const sets = (s.entries[exId] || []).filter(Boolean);
      if (!sets.length) return null;
      const best = Math.max(...sets.map((x) => e1rm(x.w, x.r)));
      const volume = sets.reduce((a, x) => a + x.w * x.r, 0);
      return { label: shortDate(s.date), value: Math.round(best * 10) / 10, volume };
    })
    .filter(Boolean);

  if (points.length < 2) {
    host.innerHTML =
      '<div class="empty">Χρειάζονται τουλάχιστον δύο καταγεγραμμένες προπονήσεις για να σχηματιστεί γραμμή.</div>';
    return;
  }

  host.appendChild(lineChart(points, { unit: 'kg', label: 'Εκτιμώμενο 1RM ανά προπόνηση' }));

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const rows = [
    ['Εκτιμώμενο 1RM τώρα', num(last) + ' kg'],
    ['Μεταβολή από την αρχή', (delta >= 0 ? '+' : '') + num(delta) + ' kg'],
    ['Όγκος τελευταίας', num(points[points.length - 1].volume, 0) + ' kg'],
    ['Καταγεγραμμένες', points.length]
  ];
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
    stats.appendChild(row);
  });
}

$('#bw-save').addEventListener('click', () => {
  const input = $('#bw-input');
  const kg = Number(input.value);
  if (!Number.isFinite(kg) || kg < 30 || kg > 250) return;
  const existing = state.bodyweight.find((b) => b.date === today());
  if (existing) existing.kg = kg;
  else state.bodyweight.push({ id: uid(), date: today(), kg });
  save('bodyweight');
  input.value = '';
  renderBodyweight();
});

function renderBodyweight() {
  const host = $('#bw-chart');
  const stats = $('#bw-stats');
  host.innerHTML = '';
  stats.innerHTML = '';
  const rows = [...state.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) {
    host.innerHTML = '<div class="empty">Ζυγίσου την ίδια ώρα, 2–3 φορές την εβδομάδα. Ο μέσος όρος μετράει, όχι η μεμονωμένη μέρα.</div>';
    return;
  }
  host.appendChild(
    lineChart(rows.map((r) => ({ label: shortDate(r.date), value: r.kg })), { unit: 'kg', label: 'Σωματικό βάρος' })
  );
  const recent = rows.slice(-7);
  const avg = recent.reduce((a, r) => a + r.kg, 0) / recent.length;
  const delta = rows[rows.length - 1].kg - rows[0].kg;
  [
    ['Μέσος όρος 7 τελευταίων', num(avg) + ' kg'],
    ['Μεταβολή από την αρχή', (delta >= 0 ? '+' : '') + num(delta) + ' kg']
  ].forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
    stats.appendChild(row);
  });
}

$('#m-save').addEventListener('click', () => {
  const sh = Number($('#m-shoulders').value);
  const wa = Number($('#m-waist').value);
  if (!Number.isFinite(sh) || !Number.isFinite(wa) || sh <= 0 || wa <= 0) return;
  const existing = state.measurements.find((m) => m.date === today());
  if (existing) Object.assign(existing, { shoulders: sh, waist: wa });
  else state.measurements.push({ id: uid(), date: today(), shoulders: sh, waist: wa });
  save('measurements');
  $('#m-shoulders').value = '';
  $('#m-waist').value = '';
  renderRatio();
});

function renderRatio() {
  const host = $('#ratio-chart');
  const display = $('#ratio-display');
  host.innerHTML = '';
  display.innerHTML = '';
  const rows = [...state.measurements].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return;

  const latest = rows[rows.length - 1];
  const ratio = latest.shoulders / latest.waist;
  display.innerHTML =
    `<div class="headline-number" style="margin-top:10px">${ratio.toFixed(2)} <span>ώμοι προς μέση</span></div>` +
    `<p class="hint">Γύρω στο 1.4 θεωρείται έντονα αθλητική σιλουέτα. Ανεβαίνει είτε πλαταίνοντας τους ώμους είτε στενεύοντας τη μέση — δούλεψε και τα δύο.</p>`;

  if (rows.length >= 2) {
    host.appendChild(
      lineChart(
        rows.map((r) => ({ label: shortDate(r.date), value: Math.round((r.shoulders / r.waist) * 100) / 100 })),
        { label: 'Λόγος ώμων προς μέση' }
      )
    );
  }
}

function renderVolume() {
  const host = $('#volume-list');
  host.innerHTML = '';
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const counts = {};
  state.sessions
    .filter((s) => s.date >= cutoff)
    .forEach((s) => {
      Object.entries(s.entries).forEach(([exId, sets]) => {
        const ex = exById(exId);
        if (!ex) return;
        counts[ex.group] = (counts[ex.group] || 0) + sets.filter(Boolean).length;
      });
    });

  WEEKLY_VOLUME.forEach((v) => {
    const done = counts[v.group] || 0;
    const item = document.createElement('div');
    item.className = 'volume-item';
    item.innerHTML =
      `<div class="volume-head"><span>${v.group}</span>` +
      `<span class="count">${done} <span style="color:var(--muted);font-weight:400">/ ${v.target} σετ</span></span></div>`;
    item.appendChild(barRow(done, v.max));
    const note = document.createElement('div');
    note.className = 'volume-note';
    note.textContent = v.note;
    item.appendChild(note);
    host.appendChild(item);
  });

  const caption = document.createElement('p');
  caption.className = 'hint';
  caption.textContent = 'Σετ που καταγράφηκαν τις τελευταίες 7 ημέρες, σε σχέση με το εβδομαδιαίο εύρος που στηρίζει η έρευνα.';
  host.appendChild(caption);
}

function renderHistory() {
  const host = $('#history-list');
  host.innerHTML = '';
  const rows = sortedSessions().slice(-12).reverse();
  if (!rows.length) {
    host.innerHTML = '<div class="empty">Δεν υπάρχει ακόμη ιστορικό.</div>';
    return;
  }
  rows.forEach((s) => {
    const setCount = Object.values(s.entries).reduce((a, x) => a + x.filter(Boolean).length, 0);
    const volume = Object.entries(s.entries).reduce(
      (a, [, sets]) => a + sets.filter(Boolean).reduce((b, x) => b + x.w * x.r, 0),
      0
    );
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML =
      `<span>Ημέρα ${PROGRAM[s.day].letter} · ${setCount} σετ${s.done ? '' : ' (ανοιχτή)'}</span>` +
      `<span class="when">${shortDate(s.date)} · ${num(volume, 0)} kg</span>`;
    host.appendChild(item);
  });
}

/* ---------- Διατροφή ---------- */

function fillNutritionSelects() {
  const act = $('#n-activity');
  NUTRITION.activity.forEach((a) => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.label;
    act.appendChild(o);
  });
  act.value = '1.55';

  const goal = $('#n-goal');
  NUTRITION.goals.forEach((g) => {
    const o = document.createElement('option');
    o.value = g.id;
    o.textContent = g.label;
    goal.appendChild(o);
  });
}

function loadProfile() {
  const p = state.profile;
  if (!p) return;
  $('#n-weight').value = p.weight ?? '';
  $('#n-height').value = p.height ?? '';
  $('#n-age').value = p.age ?? '';
  $('#n-sex').value = p.sex ?? 'm';
  $('#n-activity').value = p.activity ?? 1.55;
  $('#n-goal').value = p.goal ?? 'recomp';
  renderNutrition();
}

$('#n-calc').addEventListener('click', () => {
  const p = {
    weight: Number($('#n-weight').value),
    height: Number($('#n-height').value),
    age: Number($('#n-age').value),
    sex: $('#n-sex').value,
    activity: Number($('#n-activity').value),
    goal: $('#n-goal').value
  };
  if (!p.weight || !p.height || !p.age) {
    $('#n-results').innerHTML =
      '<h3>Ημερήσιοι στόχοι</h3><div class="empty">Συμπλήρωσε βάρος, ύψος και ηλικία.</div>';
    return;
  }
  state.profile = p;
  save('profile');
  renderNutrition();
});

function renderNutrition() {
  const p = state.profile;
  const host = $('#n-results');
  if (!p) return;

  /* Mifflin-St Jeor */
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * p.activity;
  const goal = NUTRITION.goals.find((g) => g.id === p.goal);
  const kcal = Math.round((tdee * (1 + goal.delta)) / 10) * 10;

  const protein = Math.round(p.weight * NUTRITION.proteinPerKg);
  const fat = Math.round(p.weight * NUTRITION.fatPerKg);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const perMeal = Math.round(protein / 4);

  const low = kcal < NUTRITION.caloriesFloor;

  host.innerHTML = `
    <h3>Ημερήσιοι στόχοι</h3>
    <div class="headline-number">${kcal.toLocaleString('el-GR')} <span>θερμίδες</span></div>
    <p class="hint">Συντήρηση περίπου ${Math.round(tdee / 10) * 10} θερμίδες. ${goal.hint}</p>
    <div class="macro-grid">
      <div class="macro"><span class="n">${protein}</span><span class="l">γρ. πρωτεΐνη</span></div>
      <div class="macro"><span class="n">${carbs}</span><span class="l">γρ. υδατάνθρακες</span></div>
      <div class="macro"><span class="n">${fat}</span><span class="l">γρ. λιπαρά</span></div>
    </div>
    <div class="stat-row" style="margin-top:14px">
      <span class="k">Πρωτεΐνη ανά γεύμα (4 γεύματα)</span><span class="v">${perMeal} γρ.</span>
    </div>
    <div class="stat-row">
      <span class="k">Πρωτεΐνη ανά κιλό</span><span class="v">${NUTRITION.proteinPerKg}</span>
    </div>
    <p class="hint">Εύρος πρωτεΐνης 1.6–2.2 g/kg, δηλαδή ${Math.round(p.weight * 1.6)}–${Math.round(p.weight * 2.2)} γραμμάρια. Ο αριθμός πάνω είναι μια καλή αφετηρία μέσα σε αυτό το εύρος.</p>
    ${low ? '<div class="warn">Ο υπολογισμός βγάζει πολύ χαμηλές θερμίδες. Διάλεξε ηπιότερο στόχο ή συζήτησέ το με διαιτολόγο πριν προχωρήσεις.</div>' : ''}
    <p class="hint">Αυτοί είναι υπολογισμοί αφετηρίας από εξίσωση, όχι μέτρηση. Κράτησέ τους 3–4 εβδομάδες και προσάρμοσε με βάση το τι δείχνουν η ζυγαριά, οι φωτογραφίες και η απόδοση στο γυμναστήριο.</p>
  `;
}

/* ---------- Οδηγός ---------- */

function renderGuide() {
  const host = $('#guide-list');
  host.innerHTML = '';
  GUIDE.forEach((section, i) => {
    const d = document.createElement('details');
    d.className = 'accordion';
    if (i === 0) d.open = true;
    d.innerHTML =
      `<summary>${section.title}</summary>` +
      `<div class="content">${section.body.map((p) => `<p>${p}</p>`).join('')}</div>`;
    host.appendChild(d);
  });
}

/* ---------- Ρυθμίσεις ---------- */

function renderSettings() {
  $('#storage-mode').textContent =
    store.storageMode() === 'local'
      ? 'Τα δεδομένα γράφονται στη συσκευή και ανεβαίνουν μόνα τους στο cloud.'
      : 'Ο browser μπλοκάρει την τοπική αποθήκευση, οπότε τα δεδομένα κρατιούνται μόνο για αυτή τη συνεδρία. Σε κανονική σελίδα θα αποθηκεύονται μόνιμα.';
  renderSyncStatus();
}

function syncWording() {
  const s = store.syncState();
  const time = s.at
    ? new Date(s.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })
    : null;
  if (s.status === 'syncing') return { text: 'Γίνεται συγχρονισμός…', ok: true };
  if (s.status === 'error') {
    return {
      text: 'Χωρίς σύνδεση αυτή τη στιγμή. Τα δεδομένα είναι ασφαλή στη συσκευή και θα ανέβουν μόλις ξαναβρεθεί δίκτυο.',
      ok: false
    };
  }
  if (s.status === 'ok') {
    return {
      text: 'Όλα συγχρονισμένα' + (time ? ' · τελευταία φορά ' + time : '') + '.',
      ok: true
    };
  }
  return { text: 'Αναμονή για πρώτο συγχρονισμό…', ok: true };
}

function renderSyncStatus() {
  const w = syncWording();
  const host = $('#sync-status');
  if (host) setStatus(host, w.text, w.ok);
  const dot = $('#sync-dot');
  if (dot) {
    const s = store.syncState();
    dot.dataset.state = s.status;
    dot.setAttribute('title', w.text);
  }
}

function setStatus(el, message, ok) {
  el.innerHTML = `<div class="status ${ok ? 'ok' : 'err'}">${message}</div>`;
}

$('#sync-now').addEventListener('click', () => store.syncNow());

window.addEventListener('lean:sync', renderSyncStatus);

/* Όταν έρθουν νέα δεδομένα από άλλη συσκευή, ανανέωσε τις οθόνες —
   εκτός αν γράφεις εκείνη τη στιγμή ένα σετ. */
window.addEventListener('lean:data', () => {
  state.sessions = store.read('sessions', []);
  state.bodyweight = store.read('bodyweight', []);
  state.measurements = store.read('measurements', []);
  state.profile = store.read('profile', null);
  if (state.editing) return;
  loadProfile();
  renderAll();
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tsak-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus($('#data-status'), 'Το αρχείο κατέβηκε.', true);
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    store.importAll(JSON.parse(await file.text()));
    state.sessions = store.read('sessions', []);
    state.bodyweight = store.read('bodyweight', []);
    state.measurements = store.read('measurements', []);
    state.profile = store.read('profile', null);
    renderAll();
    setStatus($('#data-status'), 'Τα δεδομένα φορτώθηκαν.', true);
  } catch (err) {
    setStatus($('#data-status'), 'Το αρχείο δεν διαβάστηκε: ' + err.message, false);
  }
  e.target.value = '';
});

$('#reset-btn').addEventListener('click', async () => {
  if (!confirm('Θα διαγραφούν όλες οι προπονήσεις και οι μετρήσεις, και από τη συσκευή και από το cloud. Συνέχεια;')) return;
  await store.clearAll();
  state.sessions = [];
  state.bodyweight = [];
  state.measurements = [];
  state.profile = null;
  renderAll();
  setStatus($('#data-status'), 'Όλα διαγράφηκαν.', true);
});

/* ---------- Πλοήγηση ---------- */

function showView(name) {
  state.view = name;
  ['train', 'progress', 'nutrition', 'guide', 'settings'].forEach((v) => {
    $('#view-' + v).hidden = v !== name;
  });
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === name)));
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

/* ---------- Εκκίνηση ---------- */

function renderAll() {
  renderMasthead();
  renderTrain();
  renderProgress();
  renderNutrition();
}

state.day = suggestedDay();
fillNutritionSelects();
renderGuide();
loadProfile();
renderAll();
renderSettings();

/* Πρώτος γύρος συγχρονισμού μόλις σταθεί η οθόνη. */
store.syncNow();
