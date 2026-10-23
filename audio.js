/* Original score: “Sugar Orbit”, 16 bars in C major, 112 BPM (~34 seconds).
 * Melody, accompaniment and percussion are synthesized locally; no audio downloads.
 */
(() => {
  'use strict';
  const melody = [
    [76,79,81,79,76,72,74,76], [79,0,76,74,72,0,74,76],
    [76,81,84,83,81,76,79,81], [79,76,74,72,71,0,72,74],
    [77,81,84,81,79,77,76,74], [72,0,77,79,81,79,77,76],
    [74,79,83,81,79,74,76,77], [79,0,77,74,71,74,76,79],
    [84,83,81,79,76,79,81,84], [83,79,76,74,72,0,76,79],
    [81,84,88,86,84,81,79,76], [79,81,79,76,74,0,72,74],
    [77,81,84,86,84,81,79,77], [76,77,79,81,79,77,76,72],
    [74,77,79,83,86,83,81,79], [77,74,71,74,79,0,74,71]
  ];
  const chords = [[60,64,67,71],[60,64,67,71],[57,60,64,67],[57,60,64,67],
    [53,57,60,64],[53,57,60,64],[55,59,62,67],[55,59,62,67]];
  const stepLength = 60 / 112 / 4;
  const musicVoices = new Set();
  let context, master, musicBus, fxBus, noiseBuffer, musicAnalyser;
  let musicEnabled = true, effectsEnabled = true, unlocked = false;
  let scene = 'ready', finale = false, timer = null, nextTime = 0, step = 0;
  let lastEffect = -Infinity;
  const comboNotes = [72,74,76,77,79]; // do re mi fa sol, then hold sol.
  let lastComboMidi = null;
  try {
    musicEnabled = localStorage.getItem('candy-music') !== 'off';
    effectsEnabled = localStorage.getItem('candy-effects') !== 'off';
  } catch {}

  function ensureContext() {
    if (context) return context;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio unavailable');
    context = new Audio();
    master = context.createDynamicsCompressor();
    master.threshold.value = -14;
    master.ratio.value = 5;
    master.connect(context.destination);
    musicBus = context.createGain(); musicBus.gain.value = .42;
    musicAnalyser = context.createAnalyser();musicAnalyser.fftSize = 1024;
    musicBus.connect(musicAnalyser);musicAnalyser.connect(master);
    fxBus = context.createGain(); fxBus.gain.value = .7; fxBus.connect(master);
    noiseBuffer = context.createBuffer(1, context.sampleRate * .08, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function remember() {
    try {localStorage.setItem('candy-music', musicEnabled ? 'on' : 'off');localStorage.setItem('candy-effects', effectsEnabled ? 'on' : 'off');} catch {}
  }

  function voice(source, gain, at, duration, musical) {
    const record = {source, gain};
    if (musical) musicVoices.add(record);
    source.onended = () => {musicVoices.delete(record);source.disconnect();gain.disconnect();};
    source.start(at);
    source.stop(at + duration);
  }

  function note(midi, at, duration, volume, type = 'triangle', bus = musicBus, musical = true) {
    if (!midi) return;
    const source = context.createOscillator(), gain = context.createGain();
    source.type = type;
    source.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain);gain.connect(bus);
    voice(source, gain, at, duration + .02, musical);
  }

  function kick(at) {
    const source = context.createOscillator(), gain = context.createGain();
    source.frequency.setValueAtTime(130, at);
    source.frequency.exponentialRampToValueAtTime(44, at + .14);
    gain.gain.setValueAtTime(.085, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .16);
    source.connect(gain);gain.connect(musicBus);voice(source, gain, at, .18, true);
  }

  function hat(at, strong) {
    const source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter();
    source.buffer = noiseBuffer;filter.type = 'highpass';filter.frequency.value = 6500;
    gain.gain.setValueAtTime(strong ? .026 : .014, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .055);
    source.connect(filter);filter.connect(gain);gain.connect(musicBus);
    voice(source, gain, at, .07, true);
    const cleanup = source.onended;
    source.onended = () => {filter.disconnect();cleanup();};
  }

  function scheduleStep(index, at) {
    const bar = Math.floor(index / 16) % melody.length, beat = index % 16, chord = chords[bar % chords.length];
    if (beat % 2 === 0) note(melody[bar][beat / 2], at, stepLength * 1.65, .075);
    if ([0,6,8,12].includes(beat)) note(chord[beat === 6 || beat === 12 ? 2 : 0] - 24, at, stepLength * 2.7, .09, 'triangle');
    if (beat === 0) for (const midi of chord.slice(1,3)) note(midi, at, stepLength * 12, .025, 'sine');
    if (beat === 0 || beat === 8) kick(at);
    if (beat % 2 === 0 || finale) hat(at, beat === 4 || beat === 12);
    if (finale && beat % 2 === 1) note(chord[Math.floor(beat / 2) % 4] + 12, at, stepLength * .75, .035, 'sine');
  }

  function pump() {
    if (!context || context.state !== 'running') return;
    if (nextTime < context.currentTime - .2) nextTime = context.currentTime + .02;
    while (nextTime < context.currentTime + .12) {
      scheduleStep(step, nextTime);
      nextTime += stepLength;
      step = (step + 1) % (melody.length * 16);
    }
  }

  function stopMusic() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (!context) return;
    const now = context.currentTime;
    for (const {source,gain} of musicVoices) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(.0001, now, .012);
      try {source.stop(now + .05);} catch {}
    }
    musicVoices.clear();
  }

  function sync() {
    if (!(unlocked && musicEnabled && scene === 'playing' && !document.hidden)) {stopMusic();return;}
    if (timer !== null) return;
    nextTime = context.currentTime + .035;
    pump();
    timer = setInterval(pump, 25);
  }

  async function unlock() {
    try {ensureContext();await context.resume();unlocked = context.state === 'running';sync();} catch {}
  }

  function effect(freq = 440, duration = .08) {
    if (!effectsEnabled || !context || context.state !== 'running') return;
    // Five piercing balls can destroy many candies in one frame: keep the mix clear.
    if (context.currentTime - lastEffect < .045) return;
    lastEffect = context.currentTime;
    note(69 + 12 * Math.log2(freq / 440), context.currentTime, duration, .065, 'sine', fxBus, false);
  }

  const soundButton = document.getElementById('sound');
  const musicButton = document.createElement('button');
  musicButton.id = 'music';soundButton.before(musicButton);
  function labels() {
    soundButton.textContent = '音效 ' + (effectsEnabled ? 'ON' : 'OFF');
    musicButton.textContent = '音樂 ' + (musicEnabled ? 'ON' : 'OFF');
    for (const [button, enabled, label] of [[soundButton,effectsEnabled,'音效'],[musicButton,musicEnabled,'音樂']]) {
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', (enabled ? '關閉' : '開啟') + label);
    }
  }
  soundButton.onclick = () => {effectsEnabled = !effectsEnabled;remember();labels();unlock().then(() => effect());};
  musicButton.onclick = () => {musicEnabled = !musicEnabled;remember();labels();unlock();sync();};
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', stopMusic);
  labels();
  window.CandyAudio = {
    unlock, effect,
    combo(count) {
      lastComboMidi = comboNotes[Math.min(4,Math.max(0,count-1))];
      if (!effectsEnabled || !context || context.state !== 'running') return;
      lastEffect = context.currentTime + .14;
      note(lastComboMidi,context.currentTime,.24,.12,'triangle',fxBus,false);
      note(lastComboMidi+12,context.currentTime+.045,.17,.025,'sine',fxBus,false);
    },
    reset() {stopMusic();step = 0;},
    setScene(mode, isFinale = false) {
      if (scene === mode && finale === isFinale) return;
      if (mode === 'countdown' && scene === 'ready') step = 0;
      scene = mode;finale = isFinale;sync();
    },
    snapshot: () => {
      const samples = new Float32Array(1024);
      musicAnalyser?.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum,n) => sum + n*n, 0) / samples.length);
      return {musicEnabled,effectsEnabled,unlocked,scene,finale,lastComboMidi,playing:timer !== null,step,voices:musicVoices.size,rms,contextState:context?.state || 'not-created'};
    }
  };
})();
