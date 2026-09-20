// ============================================================
// Audio engine -- ported line-for-line from the Next.js app's
// AppContext.tsx AudioEngine (the word-audio path). One AudioContext,
// fetch + decodeAudioData, buffer source connected straight to
// destination with NO gain node. The only thing that ever changes how
// loud a sound is here is the file itself -- baked in by the Python
// server -- never a client-side gain node. That's what makes this an
// honest preview of production.
// ============================================================
class AudioEngineLite {
  constructor() {
    this.audioContext = null;
    this.cache = new Map(); // key -> AudioBuffer | 'loading' | 'failed'
  }

  async initializeContext() {
    if (this.audioContext || typeof window === 'undefined') return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { console.error('Web Audio API not supported'); return; }
    this.audioContext = new Ctor();

    if (this.audioContext.state === 'suspended') {
      const resume = () => {
        this.audioContext?.resume().catch((e) => console.warn('resume failed', e));
        window.removeEventListener('click', resume);
        window.removeEventListener('touchstart', resume);
        window.removeEventListener('keydown', resume);
      };
      ['click', 'touchstart', 'keydown'].forEach((ev) =>
        window.addEventListener(ev, resume, { once: true, passive: true })
      );
    }
  }

  async loadAudio(key, path) {
    await this.initializeContext();
    if (!this.audioContext || this.cache.has(key)) return;
    this.cache.set(key, 'loading');
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`fetch failed: ${path} (${res.status})`);
      const buf = await res.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(buf);
      this.cache.set(key, audioBuffer);
    } catch (e) {
      console.error(`failed to load ${path}`, e);
      this.cache.set(key, 'failed');
    }
  }

  getBuffer(key) {
    const v = this.cache.get(key);
    return v instanceof AudioBuffer ? v : null;
  }

  playSound(key) {
    if (!this.audioContext) { void this.initializeContext(); return; }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
      setTimeout(() => this.playSound(key), 50);
      return;
    }
    const buf = this.cache.get(key);
    if (buf instanceof AudioBuffer) {
      const source = this.audioContext.createBufferSource();
      source.buffer = buf;
      // Word audio at full volume -- no gain node, matches production.
      source.connect(this.audioContext.destination);
      source.start(0);
    } else if (buf === 'loading') {
      setTimeout(() => this.playSound(key), 100);
    }
  }

  // Not present in the original app (which only ever plays one sound at a
  // time) -- added here to chain reference sound(s) + the current sound
  // with a fixed, sample-accurate gap AFTER each sound finishes: play
  // sound 1, wait gapMs, play sound 2, wait gapMs, ... wait gapMs, play
  // the last one. Each individual sound still plays through the exact
  // same no-gain-node path as playSound() above.
  async playSequence(keys, gapMs) {
    await this.initializeContext();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    const buffers = keys.map((k) => this.getBuffer(k)).filter(Boolean);
    if (buffers.length === 0) return;
    let t = this.audioContext.currentTime + 0.05;
    for (const buffer of buffers) {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(t);
      t += buffer.duration + gapMs / 1000;
    }
  }
}

const engine = new AudioEngineLite();

// ============================================================
// UI wiring
// ============================================================

const el = (id) => document.getElementById(id);
const filenameEl = el('currentFilename');
const appliedBadge = el('appliedBadge');
const progressChip = el('progressChip');
const originalDbfsEl = el('originalDbfs');
const adjustedDbfsEl = el('adjustedDbfs');
const renderStatus = el('renderStatus');
const referenceList = el('referenceList');
const delayMsLabel = el('delayMsLabel');
const logLine = el('logLine');
const canvas = el('waveform');
const ctx = canvas.getContext('2d');

const state = {
  session: null,
  currentKey: null,
  gapMs: 600,
  currentDb: 0, // single source of truth for the committed dB value --
                // the slider, the nudge buttons, and "Set dB" all funnel
                // through onGainChange() to update this; the number
                // field's raw typed text is NOT this until committed.
};

// ---- custom controls (ported components) ----

const sliderCtrl = createCustomSlider({
  id: 'gain',
  min: -24,
  max: 24,
  step: 0.1,
  value: 0,
  keyStep: 0.5,
  ariaLabel: 'Volume adjustment in decibels',
  colorFillDefault: '#1177ED',
  colorFillHover: '#3f93f5',
  colorFillActive: '#3f93f5',
  colorThumbBorderDefault: '#1177ED',
  colorThumbBorderHover: '#3f93f5',
  colorThumbBorderActive: '#FFFFFF',
  colorTrackBackground: '#1c1c20',
  onValueChange: (v) => onGainChange(v),
});
el('gainSliderMount').appendChild(sliderCtrl.el);

const numberCtrl = createFloatingLabelInput({
  id: 'gainNumber',
  label: 'dB adjustment',
  value: '', // starts empty -- this is a "nudge by" box, not a persistent value
  type: 'number',
  accentColor: 'var(--accent-blue)',            // label color once active/focused
  parentBackground: '#0f0f12',
  inputOutlineColor: '#26262b',
  inputFocusOutlineColor: 'var(--text)',         // outline on focus = theme foreground
  foregroundColor: 'var(--text)',
  mutedForegroundColor: 'var(--text-dim)',
  rounding: '10px',
  inputHeight: '49px',
  inputPadding: '0 14px',
  // Deliberately no onValueChange here -- typing must NOT apply anything.
  // The field just tracks its own text (including a lone "-" while you're
  // mid-type) until "Adjust" (or Enter) commits it. See commitNumberInput().
});
el('gainNumberMount').appendChild(numberCtrl.el);
numberCtrl.input.step = '0.1';
numberCtrl.input.min = '-24';
numberCtrl.input.max = '24';
numberCtrl.input.placeholder = '\u00b1 dB';

const footerBadge = createFooterBadge({
  id: 'namer',
  href: 'https://namer-ui.vercel.app/',
  poweredByText: 'Powered by',
  badgeName: 'Namer UI',
  imageUrl: 'Namer.png',
  animateFlip: true,
});
el('footerBadgeMount').appendChild(footerBadge.el);

// ---- Chronicle buttons, everywhere a button appears in this app ----
// Universal rule for every button's hover state: light background, dark
// foreground, using the app's own theme colors (not pure white/black --
// the app's "black" is actually a very dark shade, --bg).
const HOVER_BG = 'var(--text)';
const HOVER_FG = 'var(--bg)';

function mountButton(mountId, config) {
  const btn = createChronicleButton({
    hoverColor: HOVER_BG,
    hoverForeground: HOVER_FG,
    width: '100%',
    ...config,
  });
  el(mountId).appendChild(btn.el);
  return btn;
}

// Solid action buttons -- each keeps its own semantic color at rest,
// all converge on the same light-bg/dark-fg treatment on hover.
const btnPlay = mountButton('btnPlayMount', {
  text: '\u25B6 Play reference + current',
  customBackground: 'var(--accent-blue)',
  customForeground: 'var(--text)',
  onClick: () => playComparison(),
});
const btnApply = mountButton('btnApplyMount', {
  text: 'Apply & Next \u2713',
  customBackground: 'var(--success)',
  customForeground: 'var(--bg)',
  onClick: () => applyCurrentAndAdvance(),
});
const btnSkip = mountButton('btnSkipMount', {
  text: 'Skip \u2192',
  customBackground: 'var(--error)',
  customForeground: 'var(--text)',
  onClick: () => skipCurrent(),
});

// Outlined / secondary buttons. Resting border is the theme's subtle
// panel-border shade -- the light theme-foreground color only shows up
// on hover (see mouseenter/mouseleave in chronicle-button.js).
function mountOutlined(mountId, config) {
  return mountButton(mountId, {
    outlined: true,
    customBackground: 'var(--text)',        // resting + base text color
    restingBorderColor: 'var(--panel-border)', // #1c1c20 -- dark at rest
    outlinedButtonBackgroundOnHover: 'var(--text)',
    width: 'auto',
    ...config,
  });
}

const btnPrev = mountOutlined('btnPrevMount', { text: '\u2190 Previous', onClick: () => goToPrevious() });
const btnPlayCurrent = mountOutlined('btnPlayCurrentMount', {
  text: '\u25B6 Current only',
  onClick: () => { if (state.currentKey) engine.playSequence([state.currentKey], 0); },
});
const btnSetDb = mountOutlined('btnSetDbMount', {
  text: 'Adjust',
  padding: '0 20px',
  width: 'auto',
  height: '49px', // lines up with the adjacent 49px-tall number field
  onClick: () => commitNumberInput(),
});
const btnRebuild = mountOutlined('btnRebuildMount', {
  text: 'Rebuild output from log',
  fontSize: '0.85rem',
  padding: '10px 16px',
  onClick: () => rebuildFromLog(),
});

// Nudge buttons -- compact outlined buttons for +/- fixed increments
function mountNudge(mountId, label, delta) {
  return mountOutlined(mountId, {
    text: label,
    fontSize: '0.85rem',
    padding: '8px 12px',
    width: 'auto',
    onClick: () => onGainChange(state.currentDb + delta),
  });
}
mountNudge('nudgeMinus1Mount', '\u22121', -1);
mountNudge('nudgeMinus01Mount', '\u22120.1', -0.1);
mountNudge('nudgePlus01Mount', '+0.1', 0.1);
mountNudge('nudgePlus1Mount', '+1', 1);

// ---- helpers ----

function setLog(msg) { logLine.textContent = msg; }

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawWaveform(buffer) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (!buffer || width === 0) return;

  const data = buffer.getChannelData(0);
  const mid = height / 2;
  const step = Math.max(1, Math.floor(data.length / width));

  ctx.beginPath();
  ctx.strokeStyle = '#1177ED';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.95;

  for (let x = 0; x < width; x++) {
    let min = 1.0, max = -1.0;
    const start = x * step;
    for (let i = 0; i < step; i++) {
      const idx = start + i;
      if (idx >= data.length) break;
      const v = data[idx];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }
    ctx.moveTo(x + 0.5, mid + min * mid * 0.95);
    ctx.lineTo(x + 0.5, mid + max * mid * 0.95);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
}

async function waitForKeys(keys, timeoutMs = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (keys.every((k) => {
      const v = engine.cache.get(k);
      return v instanceof AudioBuffer || v === 'failed';
    })) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function preloadReferences(references) {
  references.forEach((r) => {
    const key = `ref:${r.filename}`;
    engine.loadAudio(key, `/api/audio/ref/${encodeURIComponent(r.filename)}`);
  });
}

function renderReferenceList(references) {
  referenceList.innerHTML = '';
  references.forEach((r) => {
    const li = document.createElement('li');
    const dbfsText = r.dbfs === null ? 'silent' : `${r.dbfs.toFixed(2)} dBFS`;
    li.innerHTML = `<span class="ref-name">${r.filename}</span><span class="ref-dbfs">${dbfsText}</span>`;
    referenceList.appendChild(li);
  });
}

function setControlsEnabled(enabled) {
  [btnPrev, btnSkip, btnApply, btnPlay, btnPlayCurrent, btnSetDb].forEach((b) => b.setDisabled(!enabled));
  sliderCtrl.setDisabled(!enabled);
  numberCtrl.setDisabled(!enabled);
}

async function playComparison() {
  const refKeys = (state.session?.references || []).map((r) => `ref:${r.filename}`);
  const keys = state.currentKey ? [...refKeys, state.currentKey] : refKeys;
  await waitForKeys(keys);
  engine.playSequence(keys, state.gapMs);
}

async function loadCurrentPreview(adjustmentDb, originalDbfs) {
  renderStatus.textContent = 'Rendering preview\u2026';
  if (typeof originalDbfs === 'number') {
    adjustedDbfsEl.textContent = `\u2248 ${(originalDbfs + adjustmentDb).toFixed(2)} dBFS`;
  }

  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustment_db: adjustmentDb }),
  });
  const data = await res.json();

  state.currentKey = data.key;
  await engine.loadAudio(data.key, data.url);
  adjustedDbfsEl.textContent = data.adjusted_dbfs === null ? 'silent' : `${data.adjusted_dbfs.toFixed(2)} dBFS`;
  drawWaveform(engine.getBuffer(data.key));
  renderStatus.textContent = 'Ready';

  // Autoplay: as soon as this file's audio is ready, play the
  // reference sound(s) followed by the current sound.
  playComparison();
}

const debouncedPreview = debounce((db, orig) => loadCurrentPreview(db, orig), 400);

function onGainChange(db) {
  db = Math.max(-24, Math.min(24, Math.round(db * 100) / 100));
  state.currentDb = db;
  sliderCtrl.setValue(db);
  const orig = state.session?.current?.original_dbfs ?? null;
  debouncedPreview(db, orig);
}

// The number field is a "nudge by" box, not a persistent absolute value:
// it starts empty, you type an amount (positive or negative), and
// clicking "Adjust" (or pressing Enter) adds that amount to the current
// dB level -- then the field clears itself, ready for the next nudge.
// While typing, nothing is applied (including a lone "-" mid-type,
// which is why negative amounts can be typed at all).
function commitNumberInput() {
  const raw = numberCtrl.getValue();
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return; // empty / incomplete -- nothing to apply
  onGainChange(state.currentDb + parsed);
  numberCtrl.setValue(''); // clear back to empty for the next relative nudge
}

numberCtrl.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitNumberInput();
  }
});

async function skipCurrent() {
  setLog(`Skipped ${state.session?.current?.filename ?? ''} \u2014 not recorded in the log.`);
  const res = await fetch('/api/skip', { method: 'POST' });
  applySessionToUI(await res.json());
}

async function goToPrevious() {
  const res = await fetch('/api/prev', { method: 'POST' });
  applySessionToUI(await res.json());
}

async function applyCurrentAndAdvance() {
  const db = state.currentDb;
  const filename = state.session?.current?.filename;
  const res = await fetch('/api/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustment_db: db }),
  });
  const session = await res.json();
  setLog(`Applied ${db.toFixed(2)} dB to ${filename} \u2192 written to Processed/ and logged.`);
  applySessionToUI(session);
}

async function rebuildFromLog() {
  if (!confirm('Rebuild the entire output folder from the log file now?')) return;
  setLog('Rebuilding\u2026');
  const res = await fetch('/api/rebuild', { method: 'POST' });
  const data = await res.json();
  setLog(`Rebuild complete \u2014 ${data.rebuilt} file(s) written.`);
}

function applySessionToUI(session) {
  state.session = session;
  state.gapMs = session.delay_ms;
  delayMsLabel.textContent = session.delay_ms;
  progressChip.textContent = `${Math.min(session.index + 1, session.total)} / ${session.total}`;
  renderReferenceList(session.references);
  preloadReferences(session.references);

  if (session.done || !session.current) {
    filenameEl.textContent = session.total === 0
      ? 'No candidate sounds found in the raw folder.'
      : 'All files processed \u{1F389}';
    appliedBadge.hidden = true;
    originalDbfsEl.textContent = '\u2014';
    adjustedDbfsEl.textContent = '\u2014';
    renderStatus.textContent = '';
    state.currentKey = null;
    drawWaveform(null);
    setControlsEnabled(false);
    return;
  }

  setControlsEnabled(true);
  const cur = session.current;
  filenameEl.textContent = cur.filename;
  originalDbfsEl.textContent = cur.original_dbfs === null ? 'silent' : `${cur.original_dbfs.toFixed(2)} dBFS`;
  appliedBadge.hidden = !cur.already_applied;

  const startDb = cur.existing_adjustment_db ?? 0;
  state.currentDb = startDb;
  sliderCtrl.setValue(startDb);
  numberCtrl.setValue(''); // the "adjust by" box always starts empty on a new file

  loadCurrentPreview(startDb, cur.original_dbfs);
}

async function fetchSession() {
  const res = await fetch('/api/session');
  applySessionToUI(await res.json());
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawWaveform(engine.getBuffer(state.currentKey));
});

resizeCanvas();
fetchSession();
