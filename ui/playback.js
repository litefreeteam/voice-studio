/* Playback feedback follows audio events, including non-HTML Web Audio previews. */
(() => {
  let active = null;
  const bindings = new WeakMap();
  const node = (tag, className) => { const el = document.createElement(tag); el.className = className; return el; };
  function set(button, state = 'idle') {
    if (!button) return;
    button.classList.add('sound-feedback');
    if (button.dataset.soundState !== state) button.dataset.soundState = state;
    const pressed = String(state === 'playing'), busy = String(state === 'loading');
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    if (button.getAttribute('aria-busy') !== busy) button.setAttribute('aria-busy', busy);
    let symbol = [...button.children].find(el => el.classList.contains('ui-icon') || el.classList.contains('clip-play-symbol'));
    if (!symbol) { symbol = node('span', 'ui-icon icon-play'); symbol.setAttribute('aria-hidden', 'true'); button.prepend(symbol); button.dataset.soundInserted = 'true'; }
    symbol.classList.add('sound-symbol');
    if (!symbol.querySelector('.sound-wave')) {
      const wave = node('span', 'sound-wave'); wave.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 4; i++) wave.append(node('i', ''));
      symbol.append(wave);
    }
  }
  function release(owner) { if (active?.owner === owner) active = null; }
  function stop() { const previous = active; active = null; previous?.stop(); }
  function activate(owner, stopPlayback) { if (active?.owner !== owner) stop(); active = { owner, stop: stopPlayback }; }
  function bind(audio, buttons, { stop: stopPlayback = () => audio.pause(), onState = () => {}, initial = 'idle' } = {}) {
    bindings.get(audio)?.();
    let alive = true, state = 'idle';
    const controls = () => { const value = typeof buttons === 'function' ? buttons() : buttons; return (Array.isArray(value) ? value : [value]).filter(Boolean); };
    const update = next => { if (!alive) return; state = next; onState(next); controls().forEach(button => set(button, next)); };
    const handlers = {
      play: () => { activate(audio, stopPlayback); update('loading'); },
      playing: () => { activate(audio, stopPlayback); update('playing'); },
      waiting: () => { if (!audio.paused) update('loading'); },
      pause: () => { release(audio); update(audio.ended ? 'idle' : 'paused'); },
      ended: () => { release(audio); update('idle'); },
      error: () => { release(audio); update('idle'); },
      emptied: () => { release(audio); update('idle'); }
    };
    Object.entries(handlers).forEach(([event, handler]) => audio.addEventListener(event, handler));
    const dispose = () => {
      if (!alive) return; alive = false; release(audio);
      Object.entries(handlers).forEach(([event, handler]) => audio.removeEventListener(event, handler));
      controls().forEach(button => set(button)); bindings.delete(audio);
    };
    bindings.set(audio, dispose); update(audio.paused ? initial : 'loading');
    return dispose;
  }
  function enhance(audio, { label = '试听录音', button: external = null, onError = () => {} } = {}) {
    const transport = node('div', 'sound-transport'), button = external || node('button', 'button sound-media-toggle');
    if (!external) { button.type = 'button'; button.setAttribute('aria-label', label); button.append(document.createTextNode(label)); transport.append(button); }
    const seek = node('input', 'sound-media-seek'), time = node('span', 'sound-media-time');
    seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.value = 0; seek.step = 1; seek.disabled = true; seek.setAttribute('aria-label', label + '进度');
    transport.append(seek, time); audio.after(transport); audio.controls = false; audio.classList.add('sound-native-source');
    const clock = value => { const seconds = Math.max(0, Number.isFinite(value) ? value : 0); return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0'); };
    function sync() {
      transport.hidden = audio.hidden || audio.classList.contains('hidden') || !audio.getAttribute('src');
      seek.disabled = !Number.isFinite(audio.duration); seek.value = audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
      time.textContent = clock(audio.currentTime) + ' / ' + clock(audio.duration);
      if (!external) {
        const active = !audio.paused && !audio.ended;
        button.setAttribute('aria-label', active ? '暂停' + label : label);
        const symbol = button.querySelector('.ui-icon'); if (symbol) { symbol.classList.toggle('icon-pause', active); symbol.classList.toggle('icon-play', !active); }
      } else button.setAttribute('aria-label', !audio.paused && !audio.ended ? '暂停' + label : label);
    }
    if (!external) button.onclick = async () => { try { if (audio.paused) { if (audio.ended) audio.currentTime = 0; await audio.play(); } else audio.pause(); } catch (error) { set(button); onError(error); } };
    seek.oninput = () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value) / 1000 * audio.duration; };
    ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied', 'play', 'pause', 'ended'].forEach(event => audio.addEventListener(event, sync));
    const observer = new MutationObserver(sync); observer.observe(audio, { attributes: true, attributeFilter: ['hidden', 'class', 'src'] });
    const unbind = bind(audio, button, { onState: sync }); sync();
    return { button, destroy() { unbind(); observer.disconnect(); ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied', 'play', 'pause', 'ended'].forEach(event => audio.removeEventListener(event, sync)); transport.remove(); } };
  }
  window.SoundFeedback = { set, bind, activate, release, stop, enhance };
})();
