// Adapted from website/src/voice-bloom-renderer.js for the activation page.
(() => {
const TAU = Math.PI * 2;

// Three translucent particle ribbons follow the selected sound-wave reference.
// Independent points form a luminous core, an airy veil and a sparse outer edge.
function createParticles() {
  let seed = 127;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(random(), 0.0001))) * Math.cos(TAU * random());
  const particles = [];
  for (let i = 0; i < 25800; i++) {
    const type = i < 16000 ? 0 : i < 23600 ? 1 : i < 25300 ? 2 : 3;
    const x = (random() * 2 - 1) * 1.82;
    const envelope = Math.exp(-Math.pow(x / 1.65, 4));
    const spread = (type === 0 ? 0.044 : type === 1 ? 0.125 : 0.23) * (0.45 + envelope * 0.55);
    const offset = Math.max(-3, Math.min(3, gaussian())) * spread;
    const z = Math.max(-3, Math.min(3, gaussian())) * spread * 0.65;
    const lane = Math.floor(random() * 3);
    particles.push(x, offset, z, type, random() * TAU, random(), lane);
  }
  return new Float32Array(particles);
}

const vertexSource = `
  precision highp float;
  attribute vec3 position;
  attribute vec4 details;
  uniform float time;
  uniform float level;
  uniform float density;
  uniform float halo;
  uniform vec3 pointer;
  uniform vec3 indigo;
  uniform vec3 lavender;
  uniform vec3 mist;
  uniform vec3 pearl;
  varying vec3 tint;
  varying float opacity;
  void main() {
    float type = details.x;
    float phase = details.y;
    float lane = details.w;
    float x = mod(position.x + 1.82 + time * 0.027, 3.64) - 1.82;
    float envelope = exp(-pow(x / 1.65, 4.0));
    float travel = sin(time * 0.20) * 0.20;
    float twist = x * 1.1 + time * 0.12;
    float y = 0.06 + 0.24 * envelope * (1.0 + level * 0.18)
      * sin(x * 3.45 + 0.42 - travel);
    y += (position.y * cos(twist) - position.z * sin(twist)) * (1.0 + level * 0.12);
    y += (lane - 1.0) * 0.10 * cos(x * 2.3 - travel * 0.7);
    vec2 p = vec2(x, y);
    p.x += sin(time * 0.24 + phase) * 0.004;
    p.y += cos(time * 0.28 + phase) * 0.006;
    float fade = max(0.0, 1.0 - pow(abs(x) / 1.82, 4.0));
    float alpha = type < 0.5 ? 0.42 : type < 1.5 ? 0.10 : type < 2.5 ? 0.028 : 0.72;
    float size = type < 0.5 ? 1.65 + details.z * 0.75 : 1.40 + details.z * 0.70;
    if (type > 2.5) size = 1.6 + details.z * 0.8;

    // A small local parting follows the pointer without collapsing the wave.
    vec2 offset = p - pointer.xy;
    float distance = length(offset);
    float nearby = exp(-distance * distance * 10.0) * pointer.z;
    p += offset / max(distance, 0.06) * nearby * 0.065;
    size += nearby * 0.30;
    vec2 projected = vec2(p.x / 1.95, p.y * 1.5);
    gl_Position = vec4(projected, 0.0, 1.0);
    gl_PointSize = max(1.0, size * density * (1.0 + halo * 2.8));

    // A restrained violet family echoes the page's button and feature icons.
    tint = lane < 0.5 ? indigo : lane < 1.5 ? lavender : mist;
    tint = mix(tint, pearl, 0.14 + details.z * 0.20 + nearby * 0.08);
    float highlight = type < 0.5 ? exp(-pow(position.y / 0.012, 2.0)) * 0.72 : 0.0;
    tint = mix(tint, pearl, highlight);
    if (type > 2.5) tint = pearl;
    float crestLight = 1.0 + 0.25 * exp(-pow((x - 0.35) / 0.55, 2.0));
    opacity = alpha * fade * crestLight * (0.92 + 0.08 * sin(time * 0.6 + phase))
      * (1.0 + level * 0.15) * mix(1.0, 0.025, halo);
  }
`;

const fragmentSource = `
  precision mediump float;
  varying vec3 tint;
  varying float opacity;
  void main() {
    float radius = length(gl_PointCoord * 2.0 - 1.0);
    float alpha = exp(-radius * radius * 0.95) * opacity
      * (1.0 - smoothstep(0.50, 1.0, radius));
    gl_FragColor = vec4(tint * alpha, alpha);
  }
`;

function createVoiceBloomRenderer(canvas, fallback, { paused, readLevel, onMode }) {
  const styles = getComputedStyle(canvas);
  // Share the CSS palette with WebGL and Canvas so fallback colors stay consistent.
  const palette = Object.fromEntries(['indigo', 'lavender', 'mist', 'pearl'].map(name => {
    const hex = styles.getPropertyValue(`--wave-${name}`).trim().slice(1);
    return [name, [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)];
  }));
  const particles = createParticles();
  const count = particles.length / 7;
  canvas.dataset.particles = String(count);
  const resources = [];
  const gl = canvas.getContext("webgl", {
    alpha: true, premultipliedAlpha: true, antialias: false,
    depth: false, stencil: false, powerPreference: "low-power",
  });
  let program;
  let ready = false;
  let staticContext;

  function shader(type, source) {
    const result = gl.createShader(type);
    resources.push(() => gl.deleteShader(result));
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error("Particle shader unavailable");
    return result;
  }

  try {
    if (!gl) throw new Error("WebGL unavailable");
    program = gl.createProgram();
    resources.push(() => gl.deleteProgram(program));
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Particle program unavailable");
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    resources.push(() => gl.deleteBuffer(buffer));
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    const details = gl.getAttribLocation(program, "details");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(details);
    gl.vertexAttribPointer(details, 4, gl.FLOAT, false, 28, 12);
    gl.enable(gl.BLEND);
    // Premultiplied alpha preserves the violet tint on a light surface;
    // additive blending washed overlapping particles into multicolored glitter.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const [name, rgb] of Object.entries(palette)) {
      gl.uniform3fv(gl.getUniformLocation(program, name), rgb);
    }
    gl.clearColor(0, 0, 0, 0);
    ready = true;
    onMode("webgl");
  } catch {
    resources.reverse().forEach((dispose) => dispose());
    resources.length = 0;
    staticContext = fallback.getContext("2d");
    onMode("static");
  }

  const uniforms = ready ? Object.fromEntries(
    ["time", "level", "density", "halo", "pointer"].map((key) => [key, gl.getUniformLocation(program, key)]),
  ) : {};
  let animationFrame = 0;
  let elapsed = 0;
  let previous = 0;
  let lastDraw = 0;
  let frameCount = 0;
  let level = 0;
  let visible = true;
  let destroyed = false;
  const pointer = { x: 0, y: 0, strength: 0, targetX: 0, targetY: 0, targetStrength: 0 };

  function drawStatic() {
    if (!staticContext) return;
    const ctx = staticContext;
    const { width, height } = fallback;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    const verticalScale = height * 0.75;
    const horizontalScale = width / 3.9;
    for (let i = 0; i < particles.length; i += 7) {
      const [x, offset, z, type, , size, lane] = particles.subarray(i, i + 7);
      const envelope = Math.exp(-Math.pow(x / 1.65, 4));
      const twist = x * 1.1;
      const y = 0.06 + 0.24 * envelope * Math.sin(x * 3.45 + 0.42)
        + offset * Math.cos(twist) - z * Math.sin(twist)
        + (lane - 1) * 0.10 * Math.cos(x * 2.3);
      const fade = Math.max(0, 1 - Math.pow(Math.abs(x) / 1.82, 4));
      const alpha = (type === 0 ? 0.42 : type === 1 ? 0.10 : type === 2 ? 0.028 : 0.72) * fade;
      const base = lane === 0 ? palette.indigo : lane === 1 ? palette.lavender : palette.mist;
      const highlight = type === 0 ? Math.exp(-Math.pow(offset / 0.012, 2)) * 0.72 : 0;
      const initialMix = 0.14 + size * 0.20;
      const pearlMix = type === 3 ? 1 : initialMix + (1 - initialMix) * highlight;
      const rgb = base.map((value, channel) => Math.round((value + (palette.pearl[channel] - value) * pearlMix) * 255));
      ctx.fillStyle = `rgba(${rgb.join(',')},${alpha})`;
      ctx.beginPath();
      ctx.arc(width / 2 + x * horizontalScale, height / 2 - y * verticalScale,
        (0.48 + size * 0.25) * height / 180, 0, TAU);
      ctx.fill();
    }
  }

  function draw(delta = 33) {
    if (destroyed || !ready) return;
    const target = paused ? 0 : Math.max(0, Math.min(1, readLevel()));
    level += (target - level) * (1 - Math.exp(-delta / (target > level ? 75 : 230)));
    const ease = 1 - Math.exp(-delta / 240);
    pointer.x += (pointer.targetX - pointer.x) * ease;
    pointer.y += (pointer.targetY - pointer.y) * ease;
    pointer.strength += (pointer.targetStrength - pointer.strength) * ease;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3f(uniforms.pointer, pointer.x, pointer.y, pointer.strength);
    gl.uniform1f(uniforms.time, elapsed / 1000);
    gl.uniform1f(uniforms.level, level);
    // A faint halo pass adds depth while the second pass keeps each dot crisp.
    gl.uniform1f(uniforms.halo, 1);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.uniform1f(uniforms.halo, 0);
    gl.drawArrays(gl.POINTS, 0, count);
    canvas.dataset.frame = String(++frameCount);
    canvas.dataset.level = level.toFixed(3);
    canvas.dataset.interaction = pointer.strength.toFixed(3);
  }
  function tick(now) {
    animationFrame = 0;
    if (destroyed || !ready || paused || !visible || document.hidden) return;
    if (previous) elapsed += Math.min(now - previous, 80);
    previous = now;
    if (now - lastDraw >= 1000 / 30) {
      draw(Math.min(now - lastDraw, 80));
      lastDraw = now;
    }
    animationFrame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previous = 0;
    if (!destroyed && ready && !paused && visible && !document.hidden) {
      animationFrame = requestAnimationFrame(tick);
    }
  }
  function resize() {
    if (destroyed) return;
    const box = canvas.getBoundingClientRect();
    const density = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
    canvas.width = fallback.width = Math.max(1, Math.round(box.width * density));
    canvas.height = fallback.height = Math.max(1, Math.round(box.height * density));
    if (ready) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uniforms.density, density * box.height / 180);
      draw();
    } else drawStatic();
  }
  function contextLost(event) {
    event.preventDefault();
    ready = false;
    sync();
    staticContext = fallback.getContext("2d");
    onMode("static");
    drawStatic();
  }

  const resizeObserver = new ResizeObserver(resize);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  resizeObserver.observe(canvas);
  visibilityObserver.observe(canvas);
  document.addEventListener("visibilitychange", sync);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  sync();

  return {
    setPaused(value) { paused = value; if (paused) { level = 0; draw(); } sync(); },
    setPointer(x, y) {
      pointer.targetX = (x * 2 - 1) * 1.95;
      pointer.targetY = (1 - y * 2) / 1.5;
      pointer.targetStrength = 1;
    },
    clearPointer() { pointer.targetStrength = 0; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", contextLost);
      resources.reverse().forEach((dispose) => dispose());
    },
  };
}

window.createActivationWaveRenderer = createVoiceBloomRenderer;
})();
