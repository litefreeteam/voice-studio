(() => {
  const gate = document.querySelector('#activation-gate');
  const wave = document.querySelector('#activation-wave');
  const canvas = document.querySelector('#gate-wave-canvas');
  const fallback = document.querySelector('#gate-wave-fallback');
  const motion = document.querySelector('#gate-motion');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let renderer, paused = preference.matches;

  function syncMotion() {
    wave.dataset.motion = paused ? 'paused' : 'playing';
    motion.setAttribute('aria-pressed', String(paused));
    motion.setAttribute('aria-label', paused ? '播放粒子动效' : '暂停粒子动效');
    motion.title = paused ? '播放粒子动效' : '暂停粒子动效';
    motion.firstElementChild.className = `ui-icon icon-${paused ? 'play' : 'pause'}`;
    renderer?.setPaused(paused);
  }
  function syncVisibility() {
    if (gate.hidden) {
      renderer?.destroy();
      renderer = null;
      return;
    }
    if (renderer) return;
    renderer = window.createActivationWaveRenderer(canvas, fallback, {
      paused,
      readLevel: () => gate.classList.contains('is-success') ? 0.65 : 0,
      onMode(mode) {
        wave.dataset.renderer = mode;
        fallback.hidden = mode !== 'static';
        motion.hidden = mode === 'static';
      },
    });
    syncMotion();
  }
  motion.addEventListener('click', () => { paused = !paused; syncMotion(); });
  preference.addEventListener('change', event => { paused = event.matches; syncMotion(); });
  wave.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || paused) return;
    const box = canvas.getBoundingClientRect();
    renderer?.setPointer((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  });
  wave.addEventListener('pointerleave', () => renderer?.clearPointer());
  const observer = new MutationObserver(syncVisibility);
  observer.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('pagehide', () => { renderer?.destroy(); observer.disconnect(); }, { once: true });
  syncVisibility();
})();
