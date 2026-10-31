// Game Parlor sound: synthesized sound effects and background music, shared by every page.
// No audio files: everything is made with Web Audio, so it works offline and adds almost nothing to the download.
//   sfx('dice')           play an effect (names below in FX); silent when sound is off
//   Sound.kind            the page's game type, which picks the music style and a few effect flavours
// The page gets a speaker and a music-note button (next to the "← Game Parlor" link, or in an element
// with data-sound, or floating in a corner). Both settings are shared by every game.
(function () {
  'use strict';
  var KEY = 'parlor-sound';
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  var KINDS = {
    cards: 'blackjack crazy-eights cribbage euchre free-cell gin-rummy go-fish hearts klondike poker pyramid-solitaire rummy snap spades spider-solitaire war',
    dice: 'bunco horse-race farkle five-dice liars-dice pig ship-captain-crew shut-the-box ludo snakes-and-ladders',
    board: 'five-in-a-row viking-chess fox-and-geese royal-game-of-ur backgammon checkers chess go hex mancala morris reversi shogi xiangqi star-checkers four-in-a-row tic-tac-toe ultimate-tic-tac-toe dots-and-boxes nim fleet-hunt dominoes hexhaven',
    puzzle: 'picture-cross lights-off box-pusher tower-of-hanoi bridges pipe-connect cross-sums memory-match mahjong-solitaire sudoku mine-sweep peg-solitaire sliding-fifteen code-breaker labyrinth lineup-detective',
    word: 'word-search word-guess word-jumble mini-crossword letter-grid hangman word-ladder word-tiles twenty-questions',
    arcade: 'tile-clear snake block-drop sweet-swap merge-tiles'
  };
  var kind = 'lobby';
  for (var k in KINDS) if ((' ' + KINDS[k] + ' ').indexOf(' ' + page + ' ') >= 0) kind = k;

  var cfg = { sfx: true, music: false };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || '{}'); if (typeof saved.sfx === 'boolean') cfg.sfx = saved.sfx; if (typeof saved.music === 'boolean') cfg.music = saved.music; } catch (e) {}
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

  /* ---------- audio graph ---------- */
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master, sfxBus, musicBus, noiseBuf;
  function init() {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch (e) { ctx = null; return null; }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    // a soft echo gives the music some room
    var dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.33; fb.gain.value = 0.28; wet.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 2200;
    musicBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    if (cfg.music) startMusic();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, unlock, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (cfg.sfx || cfg.music) ctx.resume();
  });

  // One oscillator note with a quick attack and an exponential fade.
  function tone(f, dur, o) {
    o = o || {};
    var t = ctx.currentTime + (o.at || 0), g = ctx.createGain(), osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var v = o.vol == null ? 0.3 : o.vol, a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  // A filtered burst of noise: card snaps, dice clacks, swishes.
  function noise(dur, o) {
    o = o || {};
    var t = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = o.filter || 'bandpass'; f.frequency.setValueAtTime(o.f || 2000, t); f.Q.value = o.q || 1;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  var R = function (a, b) { return a + Math.random() * (b - a); };
  var notes = function (fs, step, o) { fs.forEach(function (f, i) { tone(f, (o && o.dur) || 0.25, Object.assign({}, o, { at: ((o && o.at) || 0) + i * step })); }); };

  /* ---------- effects ---------- */
  var FX = {
    click: function () { tone(1500, 0.03, { vol: 0.06, type: 'triangle' }); },
    tap: function () { tone(700, 0.07, { vol: 0.14, type: 'triangle' }); },
    select: function () { tone(880, 0.06, { vol: 0.12, type: 'triangle' }); tone(1320, 0.06, { vol: 0.06, at: 0.03 }); },
    card: function (o) { noise(0.06, { f: R(2200, 3200), q: 0.8, vol: 0.45, at: o.at }); tone(R(150, 190), 0.05, { vol: 0.18, at: o.at }); },
    deal: function (o) { for (var i = 0; i < (o.n || 4); i++) FX.card({ at: i * 0.075 }); },
    shuffle: function () { for (var i = 0; i < 16; i++) noise(0.03, { f: R(2500, 4500), q: 1.5, vol: R(0.12, 0.25), at: i * 0.028 + R(0, 0.01) }); noise(0.12, { f: 1800, vol: 0.25, at: 0.47 }); },
    flip: function () { noise(0.11, { f: 900, to: 3500, q: 1.2, vol: 0.35 }); },
    slide: function () { noise(0.12, { f: 1600, to: 700, q: 0.7, vol: 0.2 }); },
    dice: function () {
      var t = 0;
      for (var i = 0; i < 7; i++) {
        var v = 0.5 * (1 - i / 9);
        noise(0.025, { f: R(2500, 4500), q: 4, vol: v, at: t });
        tone(R(900, 1700), 0.035, { type: 'triangle', vol: v * 0.35, at: t });
        t += R(0.035, 0.09) + i * 0.012;
      }
    },
    shake: function () { for (var i = 0; i < 10; i++) noise(0.03, { f: R(1800, 3000), q: 3, vol: 0.2, at: i * 0.045 }); },
    place: function (o) { tone(R(200, 240), 0.12, { to: 120, vol: 0.45, at: o.at }); noise(0.03, { filter: 'lowpass', f: 1400, vol: 0.3, at: o.at }); },
    move: function () { tone(R(300, 340), 0.08, { to: 200, vol: 0.3 }); noise(0.025, { filter: 'lowpass', f: 1800, vol: 0.18 }); },
    capture: function () { FX.place({}); tone(R(620, 680), 0.06, { type: 'square', vol: 0.06, at: 0.05 }); noise(0.04, { f: 3000, q: 2, vol: 0.25, at: 0.05 }); },
    check: function () { notes([988, 1319], 0.09, { type: 'triangle', vol: 0.15, dur: 0.2 }); },
    drop: function () { tone(700, 0.18, { to: 260, vol: 0.15, type: 'triangle' }); FX.place({ at: 0.17 }); },
    good: function () { notes([784, 1175], 0.08, { vol: 0.2, dur: 0.35 }); tone(2350, 0.3, { vol: 0.04, at: 0.08 }); },
    bad: function () { tone(220, 0.14, { type: 'square', vol: 0.06 }); tone(185, 0.2, { type: 'square', vol: 0.06, at: 0.12 }); },
    step: function () { tone(R(560, 640), 0.04, { type: 'triangle', vol: 0.1 }); },
    climb: function () { notes([523, 659, 784, 988, 1175, 1319], 0.06, { type: 'triangle', vol: 0.12, dur: 0.15 }); },
    fall: function () { noise(0.45, { filter: 'highpass', f: 4500, vol: 0.12, attack: 0.05 }); tone(900, 0.6, { to: 160, type: 'triangle', vol: 0.12, at: 0.1 }); },
    clack: function () { noise(0.03, { f: 3200, q: 3, vol: 0.4 }); tone(R(1000, 1200), 0.04, { type: 'triangle', vol: 0.15 }); tone(R(260, 300), 0.06, { vol: 0.2 }); },
    splash: function () { noise(0.4, { f: 1200, to: 400, q: 0.6, vol: 0.3, attack: 0.02 }); },
    boom: function (o) { noise(o.big ? 0.9 : 0.5, { filter: 'lowpass', f: 900, to: 120, vol: 0.6 }); tone(110, o.big ? 0.8 : 0.4, { to: 40, vol: 0.4 }); },
    chips: function () { for (var i = 0; i < 4; i++) { tone(R(2400, 3400), 0.05, { type: 'triangle', vol: 0.07, at: i * 0.035 + R(0, 0.01) }); noise(0.02, { f: 5000, q: 3, vol: 0.12, at: i * 0.035 }); } },
    score: function () { tone(988, 0.08, { type: 'square', vol: 0.07 }); tone(1319, 0.22, { type: 'square', vol: 0.07, at: 0.07 }); },
    pop: function () { tone(R(380, 460), 0.07, { to: 1100, vol: 0.22 }); },
    eat: function () { tone(520, 0.07, { to: 1300, type: 'square', vol: 0.07 }); },
    bounce: function () { tone(R(420, 470), 0.05, { type: 'square', vol: 0.07 }); },
    clear: function (o) { var n = Math.min(4, o.n || 1); notes([523, 659, 784, 1047, 1319, 1568].slice(0, 2 + n), 0.05, { type: 'triangle', vol: 0.16, dur: 0.18 }); },
    key: function () { noise(0.015, { filter: 'highpass', f: 3000, vol: 0.12 }); tone(R(1100, 1300), 0.02, { vol: 0.05, type: 'triangle' }); },
    error: function () { tone(150, 0.18, { type: 'sawtooth', vol: 0.06 }); },
    turn: function () { tone(1047, 0.18, { vol: 0.09 }); tone(1568, 0.25, { vol: 0.05, at: 0.06 }); },
    start: function () { notes([523, 784], 0.07, { type: 'triangle', vol: 0.12, dur: 0.18 }); },
    tick: function () { tone(2000, 0.015, { vol: 0.05, type: 'square' }); },
    win: function () {
      notes([523, 659, 784, 1047], 0.11, { type: 'triangle', vol: 0.2, dur: 0.3 });
      notes([659, 784, 1047, 1319], 0.11, { vol: 0.1, dur: 0.3 });
      tone(1047, 0.9, { type: 'triangle', vol: 0.18, at: 0.48 }); tone(1319, 0.9, { vol: 0.1, at: 0.48 }); tone(1568, 0.9, { vol: 0.08, at: 0.48 });
    },
    end: function () { notes([587, 740, 880], 0.12, { type: 'triangle', vol: 0.16, dur: 0.35 }); tone(1175, 0.7, { vol: 0.1, at: 0.36 }); },
    lose: function () { notes([494, 440, 392], 0.2, { type: 'triangle', vol: 0.16, dur: 0.35 }); tone(330, 0.9, { type: 'triangle', vol: 0.15, to: 311, at: 0.6 }); },
    draw: function () { notes([659, 587], 0.18, { type: 'triangle', vol: 0.14, dur: 0.4 }); tone(659, 0.6, { vol: 0.08, at: 0.36 }); }
  };
  var last = {};
  function play(name, o) {
    if (!cfg.sfx || !FX[name] || !init() || ctx.state !== 'running') return;
    var now = performance.now();
    if (last[name] && now - last[name] < 30) return; // the same sound twice in one tick is just louder
    last[name] = now;
    if (/^(win|lose|draw|end)$/.test(name)) last._end = now;
    try { FX[name](o || {}); } catch (e) {}
  }

  /* ---------- music ---------- */
  // Each game type has its own little generative tune: a chord loop with a bass line and a melody made up
  // from the chord and the scale, repeated in four-bar phrases and rewritten every few times round.
  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  var STYLE = {
    lobby: { bpm: 88, swing: 0.16, chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 49, 52, 55]], scale: [0, 2, 3, 5, 7, 9, 10], root: 62, lead: 'triangle', pad: 'sine', density: 0.45 },
    cards: { bpm: 92, swing: 0.2, chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 49, 52, 55]], scale: [0, 2, 3, 5, 7, 9, 10], root: 62, lead: 'triangle', pad: 'sine', density: 0.5 },
    dice: { bpm: 112, swing: 0.1, chords: [[48, 52, 55], [45, 48, 52], [53, 57, 60], [55, 59, 62]], scale: [0, 2, 4, 7, 9], root: 60, lead: 'square', pad: 'triangle', density: 0.6 },
    board: { bpm: 66, swing: 0, chords: [[45, 48, 52, 55], [41, 45, 48, 52], [48, 52, 55, 59], [43, 47, 50, 55]], scale: [0, 2, 3, 5, 7, 8, 10], root: 57, lead: 'sine', pad: 'sine', density: 0.3 },
    puzzle: { bpm: 80, swing: 0, chords: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]], scale: [0, 2, 4, 7, 9], root: 72, lead: 'sine', pad: 'triangle', density: 0.42, bell: true },
    word: { bpm: 84, swing: 0.08, chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [55, 59, 62, 65]], scale: [0, 2, 4, 5, 7, 9, 11], root: 65, lead: 'sine', pad: 'triangle', density: 0.4, bell: true },
    arcade: { bpm: 128, swing: 0, chords: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]], scale: [0, 3, 5, 7, 10], root: 69, lead: 'square', pad: 'square', density: 0.65, arp: true }
  };
  var st = STYLE[kind], timer = 0, step = 0, nextT = 0, phrase = null, loops = 0;
  function makePhrase() {
    var p = [], deg = 2;
    for (var i = 0; i < 32; i++) {
      var strong = i % 2 === 0;
      if (Math.random() < st.density * (strong ? 1.25 : 0.7)) {
        deg += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
        deg = Math.max(-2, Math.min(st.scale.length + 3, deg));
        p.push(deg);
      } else p.push(null);
    }
    p[0] = 0; p[30] = null; p[31] = null;
    return p;
  }
  function degToMidi(d) { var n = st.scale.length, o = Math.floor(d / n); return st.root + st.scale[((d % n) + n) % n] + 12 * o; }
  function scheduleStep(t) {
    var bar = Math.floor(step / 8) % st.chords.length, s = step % 8, ch = st.chords[bar], beat = 60 / st.bpm / 2;
    var o = { bus: musicBus };
    if (s === 0) ch.forEach(function (m, i) { tone(mtof(m), beat * 7.5, Object.assign({}, o, { type: st.pad, vol: 0.05, attack: 0.25, at: t - ctx.currentTime + i * 0.01 })); });
    if (s === 0 || s === 4 || (st.bpm > 100 && s % 2 === 0)) tone(mtof(ch[0] - 12 + (s === 4 && !st.arp ? 7 : 0)), beat * 1.8, Object.assign({}, o, { type: 'triangle', vol: 0.16, at: t - ctx.currentTime }));
    if (st.arp) tone(mtof(ch[s % ch.length] + 12), beat * 0.8, Object.assign({}, o, { type: 'square', vol: 0.025, at: t - ctx.currentTime }));
    var d = phrase[step % 32];
    if (d != null) {
      var m = degToMidi(d), at = t - ctx.currentTime;
      tone(mtof(m), beat * (st.bell ? 3 : 1.6), Object.assign({}, o, { type: st.lead, vol: st.lead === 'square' ? 0.035 : 0.09, at: at }));
      if (st.bell) tone(mtof(m + 12), beat * 2, Object.assign({}, o, { vol: 0.025, at: at }));
    }
    if (kind === 'dice' && s % 2 === 1) noise(0.03, { bus: musicBus, filter: 'highpass', f: 7000, vol: 0.05, at: t - ctx.currentTime });
    if (kind === 'arcade' && s % 4 === 2) noise(0.05, { bus: musicBus, filter: 'highpass', f: 5000, vol: 0.07, at: t - ctx.currentTime });
    step++;
    if (step % 32 === 0) { loops++; if (loops % 3 === 0) phrase = makePhrase(); }
  }
  function pump() {
    var beat = 60 / st.bpm / 2;
    if (nextT < ctx.currentTime - 0.1) nextT = ctx.currentTime + 0.05; // fell behind (a busy tab): skip ahead rather than burst
    while (nextT < ctx.currentTime + 0.25) {
      scheduleStep(nextT);
      nextT += beat * (step % 2 === 1 ? 1 + st.swing : 1 - st.swing);
    }
  }
  function startMusic() {
    if (timer || !init() || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') { ctx.resume(); if (ctx.state !== 'running') { ctx.onstatechange = function () { if (ctx.state === 'running' && cfg.music) startMusic(); }; return; } }
    phrase = phrase || makePhrase(); step = 0; nextT = ctx.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.5);
    pump(); timer = setInterval(pump, 60);
  }
  function stopMusic() {
    if (!timer) return;
    clearInterval(timer); timer = 0;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  }

  /* ---------- automatic hooks ---------- */
  // Every game shows its result in #modal (h2) inside #overlay; turn that into a win, lose or draw jingle,
  // unless the game already played one itself.
  function judge(text) {
    var s = (text || '').toLowerCase();
    if (/\b(tie|tied|draw|drawn|stalemate)\b|blocked: a tie/.test(s)) return 'draw';
    if (/\byou (win|won|did it|got it|shut|shot|beat|cleared|solved|made it|cracked|stumped|went out|score)|\bsolved\b|cracked|first try|congrat|well done|perfect|cleared|complete|all matched|one peg|very good|for you\b/.test(s)) return 'win';
    if (/\byou (lose|lost)|you're out|you are out|computer wins|they win|rival wins|friend wins|beats you|beat you|game over|boom|bust|out of (moves|rows|guesses|time|tries)|no (more )?(moves|matches)|stuck|the answer\b/.test(s)) return 'lose';
    if (/\bwins?\b|winner|went out|score|points|no more jumps/.test(s)) return 'end';
    return null;
  }
  function watchOverlay() {
    var ov = document.getElementById('overlay'); if (!ov || page === 'index') return;
    var wasOpen = !ov.hidden;
    new MutationObserver(function () {
      var open = !ov.hidden && getComputedStyle(ov).display !== 'none';
      if (open && !wasOpen && !(last._end && performance.now() - last._end < 2500)) {
        var h = ov.querySelector('h2,h3'), j = h && judge(h.textContent);
        if (j) play(j);
      }
      wasOpen = open;
    }).observe(ov, { attributes: true, attributeFilter: ['hidden', 'class', 'style'], childList: true, subtree: true });
  }
  // A quiet tick for buttons and menus everywhere.
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest && e.target.closest('button,select,summary,.btn,a.back');
    if (t && !t.disabled && !t.hasAttribute('data-nosound')) play('click');
  }, true);

  /* ---------- the two buttons ---------- */
  var ICON = {
    sfx: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="off" d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V5.5l11-2.5v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.5" cy="17.5" r="2.7" fill="currentColor"/><circle cx="17.5" cy="15" r="2.7" fill="currentColor"/><path class="off" d="M3 3l18 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
  };
  var css = '.sndctl{display:inline-flex;gap:2px;vertical-align:middle;margin-left:10px}.sndctl.float{position:fixed;z-index:50;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));margin:0;padding:3px;border-radius:999px;background:var(--panel,var(--card,rgba(127,127,127,.18)));box-shadow:0 2px 10px rgba(0,0,0,.18)}' +
    '.sndctl button{all:unset;box-sizing:border-box;width:32px;height:32px;margin:-6px 0;display:grid;place-items:center;border-radius:999px;color:var(--muted,currentColor);cursor:pointer;-webkit-tap-highlight-color:transparent}.sndctl.float button{margin:0}' +
    '.sndctl button:hover{background:rgba(127,127,127,.15)}.sndctl button:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:1px}' +
    '.sndctl svg{width:19px;height:19px}.sndctl [aria-pressed=false]{opacity:.55}.sndctl [aria-pressed=true] .off,.sndctl [aria-pressed=false] .on{display:none}';
  function mount() {
    if (document.querySelector('.sndctl')) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    var box = document.createElement('span'); box.className = 'sndctl';
    box.innerHTML = '<button type="button" data-nosound data-k="sfx">' + ICON.sfx + '</button><button type="button" data-nosound data-k="music">' + ICON.music + '</button>';
    var slot = document.querySelector('[data-sound]'), back = document.querySelector('a.back');
    if (slot) slot.appendChild(box);
    else if (back) back.insertAdjacentElement('afterend', box);
    else { box.classList.add('float'); document.body.appendChild(box); }
    var paint = function () {
      [].forEach.call(box.querySelectorAll('button'), function (b) {
        var k = b.dataset.k, on = cfg[k];
        b.setAttribute('aria-pressed', on);
        b.title = k === 'sfx' ? (on ? 'Sound on (tap to mute)' : 'Sound off (tap to turn on)') : (on ? 'Music on (tap to stop)' : 'Music off (tap to play)');
        b.setAttribute('aria-label', k === 'sfx' ? 'Sound effects' : 'Music');
      });
    };
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var k = b.dataset.k; cfg[k] = !cfg[k]; save(); paint(); unlock();
      if (k === 'music') { if (cfg.music) startMusic(); else stopMusic(); }
      if (k === 'sfx' && cfg.sfx) play('select');
    });
    // keep several open tabs in step
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      try { var v = JSON.parse(e.newValue || '{}'); cfg.sfx = v.sfx !== false; cfg.music = !!v.music; } catch (x) {}
      paint(); if (!cfg.music) stopMusic();
    });
    paint(); watchOverlay();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  window.sfx = play;
  window.Sound = {
    play: play, kind: kind, _fx: FX,
    get sfx() { return cfg.sfx; }, get music() { return cfg.music; },
    judge: judge
  };
})();
