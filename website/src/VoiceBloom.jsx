import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, SpeakerHighIcon } from "@phosphor-icons/react";
import { createTranslator } from "./i18n.mjs";
import { createVoiceBloomRenderer } from "./voice-bloom-renderer";
export function VoiceBloom({
  audioRef,
  peaks,
  playing,
  audioError,
  onPreview,
  locale = "zh-CN"
}) {
  const t = createTranslator(locale);
  const canvas = useRef(null);
  const fallback = useRef(null);
  const renderer = useRef(null);
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  // Keep the server and first client render identical; read preferences in effects.
  const [paused, setPaused] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const pausedRef = useRef(paused);
  const [mode, setMode] = useState("loading");
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    pausedRef.current = preference.matches;
    setPaused(preference.matches);
    setMotionReady(true);
    const readLevel = () => {
      const player = audioRef.current;
      const samples = peaksRef.current;
      if (!player || player.paused || !samples?.length || !player.duration) return 0;
      // These RMS samples come from the actual MP3. Reading the playback clock
      // also keeps seeking and voice changes aligned without altering audio.
      const index = player.currentTime / player.duration * (samples.length - 1);
      const first = Math.floor(index);
      const fraction = index - first;
      return Math.pow((samples[first] || 0) * (1 - fraction) + (samples[Math.min(first + 1, samples.length - 1)] || 0) * fraction, 0.65);
    };
    renderer.current = createVoiceBloomRenderer(canvas.current, fallback.current, {
      paused: pausedRef.current,
      readLevel,
      onMode: setMode
    });
    return () => {
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [audioRef]);
  useEffect(() => {
    pausedRef.current = paused;
    if (motionReady) renderer.current?.setPaused(paused);
  }, [paused, motionReady]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = event => setPaused(event.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <div className="hero-art voice-bloom" data-renderer={mode} data-motion={paused ? "paused" : "playing"} data-speaking={playing ? "true" : "false"}>
      <div className="hero-art-surface" role="img" tabIndex={0} aria-label={t("冰蓝、淡紫与白色细粒子组成舒展的声浪，缓缓流动，鼠标靠近会轻轻拨动，试听时随真实人声起伏")} onPointerMove={event => {
      if (event.pointerType === "touch") return;
      const box = canvas.current.getBoundingClientRect();
      renderer.current?.setPointer((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    }} onPointerLeave={() => renderer.current?.clearPointer()} onPointerCancel={() => renderer.current?.clearPointer()} onFocus={() => renderer.current?.setPointer(0.5, 0.5)} onBlur={() => renderer.current?.clearPointer()}>
        <canvas ref={canvas} className="bloom-canvas" aria-hidden="true" />
        <canvas ref={fallback} className="bloom-fallback" aria-hidden="true" />
      </div>
      <div className="bloom-caption">
        <p>{t("每一句表达，都有自己的回响。")}</p>
        <span className="bloom-hint" aria-hidden="true">{t("靠近一点，唤醒小粒子")}</span>
        <div className="bloom-controls">
          <button className="bloom-listen" onClick={onPreview} aria-label={playing ? t("暂停声音试听") : t("试听温宁，让粒子随人声起伏")}>
            {playing ? <SpeakerHighIcon size={15} /> : <PlayIcon size={13} weight="fill" />}
            <span>{playing ? t("正在试听 · 点击暂停") : t("听见声音的心跳")}</span>
          </button>
          {mode === "webgl" && <button className="motion-toggle" aria-label={paused ? t("播放粒子动效") : t("暂停粒子动效")} aria-pressed={paused} title={paused ? t("播放动效") : t("暂停动效")} onClick={() => setPaused(value => !value)}>
              {paused ? <PlayIcon size={13} weight="fill" /> : <PauseIcon size={13} />}
            </button>}
        </div>
        {audioError && <span className="bloom-error" role="alert">{audioError}</span>}
      </div>
    </div>;
}
