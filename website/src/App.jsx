import { useEffect, useRef, useState } from "react";
import { AppleLogoIcon, WindowsLogoIcon, DownloadSimpleIcon, PlayIcon, PauseIcon, ArrowRightIcon, ArrowUpRightIcon, InfinityIcon, LaptopIcon, CubeIcon, ShieldCheckIcon, CheckIcon, CopyIcon, CodeIcon, CaretDownIcon, XIcon, ListIcon, FilmStripIcon, GameControllerIcon, BookOpenIcon, GraduationCapIcon, GlobeHemisphereWestIcon, FolderOpenIcon, FileAudioIcon, QuotesIcon } from "@phosphor-icons/react";
import "@fontsource-variable/manrope";
import catalog from "./catalog.json";
import waveforms from "./waveforms.json";
import release from "./release.json";
import { VoiceBloom } from "./VoiceBloom";
import { guides as chineseGuides } from "./guide-links.mjs";
import { createTranslator, localizeVoice, localizedPath, contactHref, contactQr } from "./i18n.mjs";
import { LanguageSwitcher } from "./LanguageSwitcher.jsx";
import { englishGuides } from "./guide-links.mjs";
function createContent(locale) {
  const t = createTranslator(locale);
  const voices = [...catalog.voices, ...catalog.characters].map(voice => localizeVoice(voice, locale));
  const guides = locale === "en" ? englishGuides : chineseGuides;
  const downloadPlatforms = {
    mac: {
      label: t("Apple 芯片 Mac"),
      suffix: "mac-arm64.dmg",
      system: t("macOS 14+ · M 系列芯片"),
      disk: 13,
      allDisk: 25,
      download: t("Apple 芯片 Mac DMG")
    },
    intel: {
      label: "Intel Mac",
      suffix: "mac-x64.dmg",
      system: t("macOS 14+ · Intel x64 · CPU 推理"),
      disk: 17,
      allDisk: 41,
      download: "Intel Mac DMG"
    },
    win: {
      label: "Windows x64",
      suffix: "windows-setup.exe",
      system: t("Windows 10 2004（19041）及以上 / Windows 11 · x64"),
      disk: 17,
      allDisk: 41,
      download: "Windows Setup"
    }
  };
  const productScreens = [{
    id: "workspace-0.4.6",
    label: t("快速配音"),
    alt: t("声悦 v0.4.6 快速配音工作台：课程文稿、声音选择、语气与批量设置")
  }, {
    id: "project-0.4.6",
    label: t("配音项目"),
    alt: t("声悦 v0.4.6 配音项目：章节、角色、逐句台词与试听导出")
  }, {
    id: "voice-library-0.4.6",
    label: t("挑选声音"),
    alt: t("声悦 v0.4.6 声音库：42 个声音、用途和语言筛选")
  }, {
    id: "creator-home-0.4.6",
    label: t("创作首页"),
    alt: t("声悦 v0.4.6 创作首页：20 套场景模板与最近创作")
  }];
  const byId = Object.fromEntries(voices.map(v => [v.id, v]));
  const groups = {
    all: voices.map(voice => voice.id),
    video: voices.filter(voice => voice.scenes.includes("video")).map(voice => voice.id),
    dialogue: voices.filter(voice => voice.scenes.includes("game") || voice.scenes.includes("dialogue")).map(voice => voice.id),
    story: voices.filter(voice => voice.scenes.includes("story") || voice.scenes.includes("bedtime")).map(voice => voice.id),
    course: ["clear-female", "teacher-female", "teacher-male", "training-female", "science-male", "tutorial-female", ...voices.filter(voice => voice.scenes.includes("course") && !["clear-female", "teacher-female", "teacher-male", "training-female", "science-male", "tutorial-female"].includes(voice.id)).map(voice => voice.id)],
    languages: voices.filter(voice => voice.language && voice.language !== "Chinese").map(voice => voice.id)
  };
  const labels = {
    Vivian: t("短视频旁白"),
    hero: t("游戏角色对白"),
    mascot: t("故事讲述"),
    Dylan: t("生活口播"),
    Uncle_Fu: t("沉稳旁白"),
    heroine: t("冒险角色"),
    robot: t("机器人助手"),
    "girl-clear": t("童声故事"),
    Serena: t("温柔讲述"),
    Aiden: t("英语课程讲解"),
    Ryan: t("英语配音"),
    Ono_Anna: t("日语配音"),
    Sohee: t("韩语配音")
  };
  const courseLabels = {
    Uncle_Fu: t("培训课程讲解"),
    Vivian: t("知识课程讲解"),
    Aiden: t("英语课程讲解")
  };
  const filters = [["all", t("全部声音")], ["video", t("短视频")], ["dialogue", t("角色对白")], ["story", t("故事讲述")], ["course", t("课程配音")], ["languages", t("多语言")]];
  const scenes = [{
    id: "video",
    name: t("短视频解说"),
    icon: FilmStripIcon,
    title: t("文案改了，声音也能跟上。"),
    text: t("产品介绍、知识分享、生活记录。找到合适的声音，把每一句打磨到满意。"),
    features: [t("支持逐句重做"), t("满意声音可复用"), t("WAV / MP3 导出")],
    voice: "Vivian"
  }, {
    id: "game",
    name: t("游戏与角色"),
    icon: GameControllerIcon,
    title: t("每个角色，都有自己的表达。"),
    text: t("为小游戏、剧情对白和角色原型编排声音。在脚本里分配角色；标准日常音色可逐句设置语气，定声角色沿用样本表达。"),
    features: [t("多角色脚本"), t("独立文件命名"), t("ZIP 批量导出")],
    voice: "hero"
  }, {
    id: "story",
    name: t("故事与绘本"),
    icon: BookOpenIcon,
    title: t("让故事里的世界，被听见。"),
    text: t("旁白、童声、卡通角色。用不同声音讲述故事，留下喜欢的角色，继续下一段冒险。"),
    features: [t("童声与人物预设"), t("自由描述声线"), t("声音克隆")],
    voice: "mascot"
  }, {
    id: "course",
    name: t("AI 批量课程配音"),
    icon: GraduationCapIcon,
    title: t("一份课程文稿，分段配好声音。"),
    text: t("网课、企业培训、操作教程。将课程文稿导入配音项目，按章节和段落组织，复用讲师声音逐段生成；改动哪段，就单独重做哪段，再合并音频、导出字幕。"),
    features: [t("按章节管理课程"), t("复用讲师声音"), t("合并音频 · SRT 字幕")],
    voice: "clear-female"
  }, {
    id: "language",
    name: t("多语言内容"),
    icon: GlobeHemisphereWestIcon,
    title: t("让你的内容，用更多语言发声。"),
    text: t("准备好目标语言的台词，选择对应语言生成配音。支持中文、英语、日语等 {0} 种语言；语言生成效果以本机试听为准。", catalog.languages.length),
    features: [t("{0} 种生成语言", catalog.languages.length), t("中英日韩网页示例"), t("音频文件直接交付")],
    voice: "Ryan"
  }];
  const commands = {
    mac: '"/Applications/声悦.app/Contents/MacOS/声悦" --cli generate --input script.json --output-dir ./audio',
    win: locale === "en" ? '& "C:\\INSTALL_DIRECTORY\\声悦.exe" --cli generate --input script.json --output-dir ./audio | Out-String' : '& "C:\\实际安装目录\\声悦.exe" --cli generate --input script.json --output-dir ./audio | Out-String',
    cli: "shengyue generate --input script.json --output-dir ./audio"
  };
  const guide = t("使用声悦 v{0} 官网安装包的无窗口 CLI。本版本免费使用。先使用 describe、status 和 preflight 检查协议、环境与模型；再用 catalog 获取声音 ID，并将多角色脚本通过 JSON 文件传入 generate --input。每批最多 5000 字、100 条，每条最多 600 字。人物声音默认定声，跨批次保持 voiceScopeId、voiceId 和 voiceRevision 一致；定声后继承样本表达，逐句情绪指令不会重新定声。只解析 stdout JSON，stderr 为进度；从 result.items[].paths.wav/mp3 读取音频路径。首次组件安装需用户明确同意后执行 setup；CLI 与桌面端共用模型与作品，无需激活。", release.version);
  const faq = [[t("有多少声音和场景模板可以选择？"), t("内置 {0} 个声音选择，包括 {1} 款固定音色和 {2} 个人物声音设计预设，每个都有预存试听，另有 {3} 套场景模板。人物声音默认先确定样本，再用于后续台词，需要人物创作与声音克隆资源。网页试听为生成示例，部分文稿比 v{4} 内置示例更新；实际效果以本机试音和确定的样本为准。", voices.length, catalog.voices.length, catalog.characters.length, catalog.templates.length, release.version)], [t("“不限次数”具体是什么意思？"), t("自定义配音、项目与 CLI 均可免费使用，不按生成次数扣额度。每次生成仍受文本长度和设备性能限制。首次启动先检查配置，再下载所需模型。网页预存试听可直接收听。")], [t("支持 AI 批量课程配音吗？"), t("支持。配音项目可导入 TXT / CSV / TSV / DOCX / PPTX 文稿，按章节、角色和段落管理，逐句生成、重做或比较历史版本。DOCX 提取正文和表格；PPTX 逐页优先读取备注，无备注时读取页面文字，不识别图片文字，也不支持 PDF。快速配音和 CLI 单批最多 5000 字、100 段；CLI 单段最多 600 字。配音项目可保存最多 1 万条台词、50 万字，并将长台词拆成短段依次处理；长课程建议按章节组织。")], [t("可以一直离线使用吗？"), t("首次安装需要联网下载声音包与运行组件。准备完成后，配音与声音克隆都在本机完成，可以离线使用。台词、参考人声和作品不会上传。")], [t("我的电脑能运行吗？"), t("提供 macOS 14+ 的 Apple 芯片和 Intel 芯片两种安装包；Windows 需要 x64、Windows 10 2004（19041）及以上，推荐 Windows 11。轻量配音最低需 8 GB 内存；标准配音、人物创作和声音克隆至少需 16 GB，可通过配置检测了解本机条件。Intel Mac 与当前 Windows 安装版使用 CPU，不包含 CUDA 加速，完整功能仍需相应实机验收。磁盘预留随平台、资源包和已有下载变化，以软件内配置检查为准。暂不支持 Linux 和 Windows ARM。")], [t("支持声音设计与声音克隆吗？"), t("可以用文字描述人物声线，也可直接录音，或从有权使用的录音中选取 3–30 秒清晰人声并核对原话。桌面端可另行准备约 486 MB 的本地识别资源，辅助填写原话，识别结果仍需人工核对。人物声音默认先试听、确定样本，后续台词与重做复用该样本；重新定声或自由设计可能改变声线。标准日常音色支持逐句语气和表演要求；轻量音色仅支持自然配音，固定人物声音沿用样本表达；声音克隆默认沿用录音表达，也可在明确下载独立的可选情绪资源后调整语气。")], [t("能编辑音频、配背景音乐和导出字幕吗？"), t("可以比较历史版本，裁剪波形、调整音量和淡入淡出，保存后用于后续试听和导出，原始音频保留。配音项目支持导入本地背景音乐、设置循环和说话时压低音乐；可先试听成品前 30 秒，再导出合并 WAV、MP3、SRT 与 ZIP。单次成品导出最多 5000 个音频段、6 小时，长项目需按章节导出。SRT 按生成片段的时长排布，并非逐字识别或视频对齐。CLI 普通 ZIP 只打包分段音频，不会自动生成项目混音或字幕。")], [t("能接入哪些 AI 智能体？会省 token 吗？"), t("支持具备本地命令执行能力的智能体，例如 Codex、Claude Code、WorkBuddy。通过 CLI 调用本机模型、返回音频路径，不把音频本体塞入对话。智能体写作和推理仍按其规则计费，实际 token 差异取决于工作流；外部智能体如何处理文稿，以其设置为准。当前没有专用 MCP 服务；官网安装包内置免费 CLI，准备模型后即可创作。")], [t("免费版换电脑怎么使用？"), t("在新电脑下载免费版，检查配置并准备所需模型即可使用，无需设备码或激活。已有作品和参考声音可自行备份；安装或使用问题可通过官网“联系我们”扫码咨询。")]];
  return {
    voices,
    guides,
    downloadPlatforms,
    productScreens,
    byId,
    groups,
    labels,
    courseLabels,
    filters,
    scenes,
    commands,
    guide,
    faq
  };
}
const clock = n => `${Math.floor((n || 0) / 60).toString().padStart(2, "0")}:${Math.floor((n || 0) % 60).toString().padStart(2, "0")}`;
function Brand({
  light = false,
  locale
}) {
  const t = createTranslator(locale);
  return <a href="#top" className={`brand ${light ? "brand-light" : ""}`} aria-label={t("声悦配音首页")}>
      <img src="/assets/brand-wave.svg" width="44" height="44" alt="" />
      <span>
        <strong>{t("声悦")}<span className="brand-product">{t("配音")}</span>
        </strong>
        <small>{t("好声音，让表达更动人")}</small>
      </span>
    </a>;
}
function Waveform({
  id,
  progress = 0
}) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const peaks = waveforms[id] || [];
    const draw = () => {
      const {
        width,
        height
      } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const step = width / Math.max(peaks.length, 1);
      peaks.forEach((peak, i) => {
        const h = Math.max(3, Math.pow(peak, 0.65) * (height - 4));
        ctx.fillStyle = i / peaks.length <= progress ? "#7253ef" : "#d8d2e5";
        ctx.beginPath();
        ctx.roundRect(i * step, (height - h) / 2, Math.max(1, step * 0.48), h, 1);
        ctx.fill();
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [id, progress]);
  return <canvas ref={ref} className="waveform" aria-hidden="true" />;
}
export function App({
  locale = "zh-CN"
}) {
  const t = createTranslator(locale);
  const {
    voices,
    guides,
    downloadPlatforms,
    productScreens,
    byId,
    groups,
    labels,
    courseLabels,
    filters,
    scenes,
    commands,
    guide,
    faq
  } = createContent(locale);
  const [filter, setFilter] = useState("all"),
    [voiceLimit, setVoiceLimit] = useState(6),
    [activeId, setActiveId] = useState(null),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [audioError, setAudioError] = useState("");
  const [sceneIndex, setSceneIndex] = useState(0),
    [platform, setPlatform] = useState("mac"),
    [downloadOpen, setDownloadOpen] = useState(false),
    [downloadPlatform, setDownloadPlatform] = useState("mac"),
    [galleryOpen, setGalleryOpen] = useState(false),
    [gallery, setGallery] = useState("workspace-0.4.6"),
    [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const audio = useRef(null),
    downloadDialog = useRef(null),
    galleryDialog = useRef(null),
    toastTimer = useRef(null),
    requestId = useRef(0);
  const scene = scenes[sceneIndex];
  const selectedDownload = downloadPlatforms[downloadPlatform];
  const galleryScreen = productScreens.find(screen => screen.id === gallery);
  function contactFromDownload(event) {
    event.preventDefault();
    downloadDialog.current.close();
    setDownloadOpen(false);
    requestAnimationFrame(() => {
      window.location.hash = "contact";
      document.getElementById("contact-title").focus({ preventScroll: true });
      document.getElementById("contact").scrollIntoView({ behavior: "instant", block: "start" });
    });
  }
  useEffect(() => {
    const d = downloadDialog.current;
    if (downloadOpen && !d.open) d.showModal();
    if (!downloadOpen && d.open) d.close();
  }, [downloadOpen]);
  useEffect(() => {
    const d = galleryDialog.current;
    if (galleryOpen && !d.open) d.showModal();
    if (!galleryOpen && d.open) d.close();
  }, [galleryOpen]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const closeMenu = event => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeMenu);
    return () => document.removeEventListener("keydown", closeMenu);
  }, []);
  function notify(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }
  async function play(id) {
    const player = audio.current,
      request = ++requestId.current;
    setAudioError("");
    if (activeId === id && !player.paused) {
      player.pause();
      return;
    }
    if (activeId !== id) {
      player.pause();
      player.src = `/assets/previews/${id}.mp3`;
      setActiveId(id);
      setPosition(0);
    }
    try {
      await player.play();
      if (request === requestId.current) window.shengyueAnalytics?.track('audio_preview', { voice_id: id });
    } catch (error) {
      if (request === requestId.current && error.name !== "AbortError") {
        setPlaying(false);
        setAudioError(t("暂时无法播放，请再试一次。"));
      }
    }
  }
  function chooseFilter(value) {
    setFilter(value);
    setVoiceLimit(6);
    audio.current.pause();
  }
  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify(t("复制未完成，请手动选择指令或下载完整 CLI 文档。"));
    }
  }
  function seek(value) {
    if (Number.isFinite(audio.current.duration)) {
      audio.current.currentTime = audio.current.duration * value / 100;
      setPosition(audio.current.currentTime);
    }
  }
  function openDownload() {
    window.shengyueAnalytics?.track('download_options');
    setDownloadPlatform(/Windows/i.test(navigator.userAgent) ? "win" : "mac");
    setDownloadOpen(true);
    setMenuOpen(false);
  }
  return <>
      <a className="skip-link" href="#voices">{t("跳到声音试听")}</a>
      <audio ref={audio} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => {
      setPlaying(false);
      setPosition(0);
    }} onTimeUpdate={() => setPosition(audio.current.currentTime)} onError={() => {
      setPlaying(false);
      setAudioError(t("声音加载失败，请稍后重试。"));
    }} />
      <div className="dark-intro" id="top">
        <header className="site-header container">
          <Brand light locale={locale} />
          <nav id="site-navigation" className={menuOpen ? "nav-links open" : "nav-links"} aria-label={t("主导航")}>
            {[["#voices", t("声音试听")], ["#scenes", t("使用场景")], ["#agents", t("智能体接入")], ["#contact", t("联系我们")]].map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>
                {label}
              </a>)}
          </nav>
          <a href={localizedPath("/download/", locale)} className="button primary nav-download" onClick={event => {
          event.preventDefault();
          openDownload();
        }}>
            <DownloadSimpleIcon size={19} />{t("下载安装")}</a>
          <button className="menu-button" aria-label={menuOpen ? t("关闭菜单") : t("打开菜单")} aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <XIcon /> : <ListIcon />}
          </button>
          <LanguageSwitcher locale={locale} path="/" />
        </header>
        <section className="hero container" aria-labelledby="hero-title">
          <VoiceBloom locale={locale} audioRef={audio} peaks={waveforms[activeId]} playing={playing} audioError={audioError} onPreview={() => playing ? audio.current.pause() : play("Serena")} />
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow">{t("声悦配音 · 本地 AI 配音软件")}<span>LOCAL VOICE. LIMITLESS IDEAS.</span>
            </p>
            <h1 id="hero-title">
              <span>{t("尽情创作，")}</span>
              <br />{t("不必数着额度配音。")}</h1>
            <p className="hero-description">{t("你的本地 AI 配音工作台。")}<br />{t("短视频、角色对白、批量课程，都能从这里发声。")}</p>
            <div className="hero-actions">
              <a className="button primary large" href={localizedPath("/download/", locale)} onClick={event => {
              event.preventDefault();
              openDownload();
            }}>
                <DownloadSimpleIcon size={24} />{t("下载桌面版")}<ArrowRightIcon size={19} />
              </a>
              <a className="listen-link" href="#voices">
                <span>
                  <PlayIcon weight="fill" size={17} />
                </span>{t("听听配音效果")}</a>
            </div>
            <p className="hero-note">{t("安装后检查配置 ")}<span>·</span>{t(" 免费使用，无需激活")}</p>
          </div>
        </section>
        <div className="benefit-strip container">
          {[{
          icon: InfinityIcon,
          title: t("免费版不限次数"),
          desc: t("改稿、重做，直到满意")
        }, {
          icon: LaptopIcon,
          title: t("资源就绪后可离线"),
          desc: t("文字和声音，都留在本机")
        }, {
          icon: CubeIcon,
          title: t("支持 Agent 调用"),
          desc: t("通过 CLI，连接你的创作流程")
        }].map(({
          icon: Icon,
          title,
          desc
        }) => <div className="benefit" key={title}>
              <Icon size={44} weight="light" />
              <div>
                <h2>{title}</h2>
                <p>{desc}</p>
              </div>
            </div>)}
        </div>
      </div>
      <main>
        <section className="voices-section section" id="voices" aria-labelledby="voices-title">
          <div className="container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MEET YOUR NEXT VOICE</p>
                <h2 id="voices-title">{t("先听，再开始你的创作。")}</h2>
              </div>
              <p className="heading-description">{t("真实生成的声音示例，点击即可试听。")}<br />{t("从一段旁白，到一个故事，找到合适的表达。")}</p>
            </div>
            <div className="filter-tabs" role="group" aria-label={t("声音使用场景")}>
              {filters.map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "selected" : ""} onClick={() => chooseFilter(id)}>
                  {label}
                </button>)}
            </div>
            <div className="voice-grid">
              {groups[filter].slice(0, voiceLimit).map(id => {
              const voice = byId[id],
                active = activeId === id,
                duration = voice.preview.duration;
              return <article key={id} className={`voice-card ${active && playing ? "is-playing" : ""}`}>
                    <div className="voice-portrait-frame">
                      <img className="voice-portrait" src={`/${voice.portrait}`} width="384" height="384" alt={t("{0}的声音配图", voice.name)} loading="lazy" />
                    </div>
                    <div className="voice-card-body">
                      <div className="voice-title">
                        <h3>{(filter === "course" ? courseLabels[id] : labels[id]) || voice.description.split(" · ")[0]}</h3>
                        <span>{voice.native || t("中文示例")}</span>
                      </div>
                      <p className="voice-name">
                        {voice.name}
                        <span> / </span>
                        {voice.description}
                      </p>
                      <div className="audio-controls">
                        <button className="play-button" aria-label={`${active && playing ? t("暂停") : t("播放")}${voice.name}`} onClick={() => play(id)}>
                          {active && playing ? <PauseIcon size={15} weight="fill" /> : <PlayIcon size={15} weight="fill" />}
                        </button>
                        <div className="waveform-control">
                          <Waveform id={id} progress={active ? position / duration : 0} />
                          <input className="waveform-seek" type="range" min="0" max="100" step=".1" value={active ? Math.min(100, position / duration * 100) : 0} disabled={!active} aria-label={t("{0}播放进度", voice.name)} aria-valuetext={clock(active ? position : 0)} onChange={e => seek(Number(e.target.value))} />
                        </div>
                        <time>
                          {clock(active ? position : duration)}
                        </time>
                      </div>
                    </div>
                  </article>;
            })}
            </div>
            <div className="voice-pagination">
              <span>{t("已展示 ")}{Math.min(voiceLimit, groups[filter].length)} / {groups[filter].length}{t(" 个声音")}</span>
              {voiceLimit < groups[filter].length && <button className="button secondary" onClick={() => setVoiceLimit(limit => limit + 6)}>{t("再听更多声音")}<ArrowRightIcon size={17} /></button>}
            </div>
            <div className="voices-footnote">
              <span>
                <ShieldCheckIcon size={17} />{t("先试听预存样本，无需安装")}</span>
              <span>
                {catalog.voices.length}{t(" 款精选音色 ")}<span className="sep">/</span> {catalog.characters.length}{t(" 个人物预设")}{" "}
                <span className="sep">/</span> {catalog.templates.length}{t(" 套场景模板")}</span>
            </div>
            <p className="voice-example-note">{t("人物配图为原创虚构角色；网页音频为真实生成示例，实际效果以本机试音和定声样本为准。")}</p>
            <p className="audio-error" role="status">
              {audioError}
            </p>
          </div>
        </section>
        <section className="product-section section" id="studio" aria-labelledby="studio-title">
          <div className="container product-layout">
            <div className="product-copy">
              <p className="eyebrow">YOUR DESKTOP. YOUR STUDIO.</p>
              <h2 id="studio-title">{t("一份脚本，")}<br />{t("让每个角色开口。")}</h2>
              <p>{t("AI 批量课程配音、多角色编排、逐句重做，")}<br />{t("把灵感整理成可以直接使用的音频。")}</p>
              <ul className="check-list">
                <li>
                  <CheckIcon />{t("导入 TXT / CSV / TSV / DOCX / PPTX 文稿")}</li>
                <li>
                  <CheckIcon />{t("按章节、角色与段落管理长篇文稿")}</li>
                <li>
                  <CheckIcon />
                  {catalog.templates.length}{t(" 套场景模板，文稿与声音一起带入")}</li>
                <li>
                  <CheckIcon />{t("比较历史版本，裁剪波形、调整音量")}</li>
                <li>
                  <CheckIcon />{t("背景音乐混音，合并 WAV / MP3 与 SRT 字幕")}</li>
              </ul>
              <button className="text-link" onClick={() => setGalleryOpen(true)}>{t("看看真实工作台")}<ArrowUpRightIcon size={19} />
              </button>
            </div>
            <button className="product-image-button" onClick={() => setGalleryOpen(true)} aria-label={t("放大查看声悦配音工作台")}>
              <img src="/assets/workspace-0.4.6.png" width="2840" height="1610" alt={productScreens[0].alt} loading="lazy" />
              <span>
                <ArrowUpRightIcon size={17} />{t("查看工作台")}</span>
            </button>
          </div>
        </section>
        <section className="scenes-section section" id="scenes" aria-labelledby="scenes-title">
          <div className="container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MADE FOR YOUR IDEAS</p>
                <h2 id="scenes-title">{t("你的下一段创作，")}<br />{t("从这里发声。")}</h2>
              </div>
              <p className="heading-description">{t("一个人的灵感，也可以有许多种声音。")}<br />{t("为常做的内容，找到顺手的配音方式。")}</p>
            </div>
            <div className="scene-tabs" role="group" aria-label={t("创作场景")}>
              {scenes.map(({
              id,
              name,
              icon: Icon
            }, index) => <button key={id} aria-pressed={sceneIndex === index} className={sceneIndex === index ? "selected" : ""} onClick={() => setSceneIndex(index)}>
                  <Icon size={20} />
                  {name}
                </button>)}
            </div>
            <div className="scene-content">
              <div className="scene-copy">
                <span className="scene-number">
                  0{sceneIndex + 1} / CREATIVE SCENARIOS
                </span>
                <h3>{scene.title}</h3>
                <p>{scene.text}</p>
                <div className="scene-features">
                  {scene.features.map(f => <span key={f}>
                      <CheckIcon size={16} />
                      {f}
                    </span>)}
                </div>
                <button className="text-link" onClick={() => play(scene.voice)}>
                  {activeId === scene.voice && playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}{t("试听")}{byId[scene.voice].name}{t("的声音")}</button>
              </div>
              <div className="scene-preview">
                <img src={`/${byId[scene.voice].portrait}`} alt="" width="384" height="384" loading="lazy" />
                <div className="scene-quote">
                  <QuotesIcon size={30} weight="fill" />
                  <p lang={byId[scene.voice].language === "English" ? "en" : byId[scene.voice].language === "Japanese" ? "ja" : byId[scene.voice].language === "Korean" ? "ko" : "zh-CN"}>{byId[scene.voice].preview.text}</p>
                  <span>{byId[scene.voice].name}{locale === "en" ? " · " + (byId[scene.voice].native || "Chinese") + " audio sample" : t(" · 声音示例")}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="value-section section">
          <div className="container value-layout">
            <div>
              <p className="eyebrow">MORE FREEDOM. LESS FRICTION.</p>
              <h2>{t("把额度的顾虑，")}<br />{t("留在创作之外。")}</h2>
              <p className="value-intro">{t("免费版不限生成次数。")}<br />{t("改一个词，换一种表达，再试一次。")}</p>
            </div>
            <div className="value-list">
              {[{
              icon: InfinityIcon,
              title: t("尽情打磨，免费本地生成"),
              text: t("本版本免费使用，生成数量不设额度上限。模型在本机运行，资源就绪后可离线配音。")
            }, {
              icon: ShieldCheckIcon,
              title: t("素材与声音，都在自己的电脑"),
              text: t("台词、参考人声与作品均在本机处理。安装准备完成后，可以离线创作。")
            }, {
              icon: FolderOpenIcon,
              title: t("满意的声音，成为你的创作积累"),
              text: t("保存角色设置与参考声音，下次接着用。逐句重做，保留已经满意的片段。")
            }].map(({
              icon: Icon,
              title,
              text
            }) => <div className="value-item" key={title}>
                  <Icon size={31} weight="light" />
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </div>)}
            </div>
          </div>
        </section>
        <section className="agents-section section" id="agents" aria-labelledby="agents-title">
          <div className="container">
            <div className="agents-heading">
              <p className="eyebrow">LOCAL VOICE. AGENT READY.</p>
              <h2 id="agents-title">{t("给你的 AI 智能体，")}<br />
                <span>{t("一座本地声音工作室。")}</span>
              </h2>
              <p>{t("脚本交给智能体，配音交给你的电脑。")}<br />{t("课程文稿、培训脚本通过 CLI 分批配音，直接获得本地音频文件。")}</p>
            </div>
            <div className="agent-flow">
              <div>
                <CodeIcon size={27} />
                <strong>{t("准备脚本")}</strong>
                <small>{t("台词、角色、情绪")}</small>
              </div>
              <ArrowRightIcon />
              <div>
                <img src="/assets/brand-wave.svg" width="42" height="42" alt="" />
                <strong>{t("声悦本地生成")}</strong>
                <small>{t("调用本机声音包")}</small>
              </div>
              <ArrowRightIcon />
              <div>
                <FileAudioIcon size={29} />
                <strong>{t("交付音频文件")}</strong>
                <small>WAV / MP3 / ZIP</small>
              </div>
            </div>
            <div className="agent-detail">
              <div className="agent-benefits">
                <h3>{t("从一次操作，到一段工作流。")}</h3>
                <p>{t("适用于 Codex、Claude Code、WorkBuddy 等")}<br className="desktop-only" />{t("具备本地命令执行能力的智能体。")}</p>
                <ul className="check-list">
                  <li>
                    <CheckIcon />{t("无需打开桌面窗口")}</li>
                  <li>
                    <CheckIcon />{t("一次调用处理多角色脚本")}</li>
                  <li>
                    <CheckIcon />{t("音频存为文件，不把音频本体放进对话")}</li>
                </ul>
                <p className="fine-print">{t("智能体自身的写作与推理仍按其规则计费。")}<br />{t("实际 token 差异取决于调用方式。")}</p>
                <p className="fine-print">{t("CLI 需使用当前官网安装包或源码版。")}<br />{t("CLI 与桌面端均可免费使用，首次需准备模型。")}</p>
              </div>
              <div className="terminal">
                <div className="terminal-tabs" role="group" aria-label={t("接入平台")}>
                  {[["mac", "macOS"], ["win", "Windows"], ["cli", t("已注册 CLI")]].map(([id, name]) => <button key={id} className={platform === id ? "selected" : ""} aria-pressed={platform === id} onClick={() => setPlatform(id)}>
                      {name}
                    </button>)}
                  <span>TERMINAL</span>
                </div>
                <div className="terminal-body">
                  <p className="code-comment">{t("# 通过本地 CLI 生成多角色配音")}</p>
                  <pre>
                    <code>{commands[platform]}</code>
                  </pre>
                  <p className="terminal-success">
                    <CheckIcon size={16} />{t("stdout 返回 JSON · 音频保存在本机")}</p>
                  <p className="code-comment">
                    {platform === "win" ? t("# 请替换为实际安装路径；Windows 待实机验收") : platform === "cli" ? t("# 源码安装后执行 npm link，注册 shengyue 命令") : t("# 首次调用前使用 --cli status 检查组件与模型")}
                  </p>
                  <button className="copy-command" onClick={() => copy(commands[platform], t("已复制配音命令"))}>
                    <CopyIcon size={16} />{t("复制命令")}</button>
                </div>
              </div>
            </div>
            <div className="agent-links">
              <button onClick={() => copy(guide, t("已复制智能体接入说明"))}>
                <CopyIcon size={17} />{t("复制给智能体的说明")}</button>
              <a href={locale === "en" ? "/docs/example-script.en.json" : "/docs/example-script.json"} download>{locale === "en" ? "Download English script example" : t("下载脚本示例")}<ArrowUpRightIcon size={17} />
              </a>
              <a href="/docs/agent-cli.md" download>{t("完整 CLI 文档")}<ArrowUpRightIcon size={17} />
              </a>
            </div>
          </div>
        </section>
        <section className="guides-section section" id="guides" aria-labelledby="guides-title">
          <div className="container">
            <div className="section-heading">
              <div><p className="eyebrow">FROM SCRIPT TO SOUND</p><h2 id="guides-title">{t("从文稿到成品，按步骤开始。")}</h2></div>
              <p className="heading-description">{t("查看课程配音、离线使用与智能体接入的实际步骤。")}</p>
            </div>
            <div className="guide-grid">
              {guides.map(guide => <a className="guide-card" key={guide.path} href={guide.path}><span>{guide.label}</span><h3>{guide.title}</h3><p>{guide.summary}</p><strong>{t("阅读指南 ")}<ArrowUpRightIcon size={17} /></strong></a>)}
            </div>
            <p className="guide-download"><a className="text-link" href={localizedPath("/download/", locale)}>{t("查看所有安装包与电脑配置要求 ")}<ArrowRightIcon size={17} /></a></p>
          </div>
        </section>
        <section className="faq-section section" id="faq" aria-labelledby="faq-title">
          <div className="container faq-layout">
            <div>
              <p className="eyebrow">A FEW THINGS TO KNOW</p>
              <h2 id="faq-title">{t("开始之前，")}<br />{t("你可能想知道。")}</h2>
              <p>{t("先听声音，再确认设备。")}<br />{t("准备好了，就开始第一段创作。")}</p>
            </div>
            <div className="faq-list">
              {faq.map(([question, answer]) => <details key={question}>
                  <summary>
                    {question}
                    <CaretDownIcon size={19} />
                  </summary>
                  <p>{answer}</p>
                </details>)}
            </div>
          </div>
        </section>
        <section className="contact-section section" id="contact" aria-labelledby="contact-title">
          <div className="container contact-layout">
            <div><p className="eyebrow">LET’S TALK</p><h2 id="contact-title" tabIndex={-1}>{t("有问题，扫码联系我们。")}</h2><p>{t("安装帮助、模型下载与使用反馈。")}</p></div>
            <figure className="contact-card"><a className="contact-qr-frame" href={contactQr} target="_blank" rel="noreferrer" aria-label={t("查看联系二维码原图")}><img src={contactQr} alt={t("微信联系二维码")} width="564" height="581" loading="lazy" /></a><figcaption><strong>{t("微信扫一扫，联系我们")}</strong><p>{t("也可保存二维码，在微信中识别。")}</p><a className="text-link" href={contactQr} download="shengyue-contact-qr.png">{t("保存二维码")}<DownloadSimpleIcon size={17} /></a></figcaption></figure>
          </div>
        </section>
        <section className="download-section" id="download">
          <div className="container download-content">
            <p className="eyebrow">LET YOUR IDEAS BE HEARD</p>
            <h2>{t("你的下一个故事，")}<br />{t("值得一个好声音。")}</h2>
            <p>{t("本版本免费使用，无需购买、设备码或激活。安装后先检查电脑配置，选择模型并下载运行组件；完成后即可离线创作。")}</p>
            <a className="button primary large" href={localizedPath("/download/", locale)} onClick={event => {
            event.preventDefault();
            openDownload();
          }}>
              <DownloadSimpleIcon size={23} />{t("下载声悦配音")}<ArrowRightIcon size={20} />
            </a>
            <span>{t("Apple 芯片 Mac · Intel Mac / Windows x64 测试构建")}</span>
            {locale === "en" && <p className="english-product-note">The current desktop app and screenshots use a Chinese interface. Audio samples remain in their original languages.</p>}
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container">
          <Brand locale={locale} />
          <div>
            <span>{t("好声音，让表达更动人。")}</span>
            <small>© {new Date().getFullYear()}{t(" 声悦配音 · v")}{release.version}</small>
          </div>
          <a href="#top">{t("回到顶部")}<ArrowUpRightIcon size={16} />
          </a>
        </div>
        <nav className="container footer-guide-links" aria-label={t("使用指南")}>
          <a href={localizedPath("/download/", locale)}>{t("桌面版下载")}</a>
          <a href={contactHref(locale)}>{t("联系我们")}</a>
          {guides.map(guide => <a key={guide.path} href={guide.path}>{guide.label}</a>)}
        </nav>
      </footer>
      <dialog ref={downloadDialog} className="download-dialog" aria-labelledby="download-title" onClose={() => setDownloadOpen(false)} onClick={e => {
      if (e.target === e.currentTarget) setDownloadOpen(false);
    }}>
        <div className="dialog-content">
          <button className="dialog-close" aria-label={t("关闭下载窗口")} onClick={() => setDownloadOpen(false)}>
            <XIcon size={22} />
          </button>
          <img className="dialog-logo" src="/assets/brand-wave.svg" width="58" height="58" alt="" />
          <p className="eyebrow">YOUR VOICE STARTS HERE</p>
          <h2 id="download-title">{t("把声音工作室，带回电脑。")}</h2>
          <p>{t("本版本免费使用，无需购买、设备码或激活。安装后先检查电脑配置，选择模型并下载运行组件；完成后即可离线创作。")}</p>
          {locale === "en" && <p className="english-product-note">The current desktop app uses a Chinese interface. This website is available in English.</p>}
          <div className="platform-tabs" role="group" aria-label={t("下载平台")}>
            {Object.entries(downloadPlatforms).map(([id, option]) => <button key={id} aria-pressed={downloadPlatform === id} className={downloadPlatform === id ? "selected" : ""} onClick={() => setDownloadPlatform(id)}>
                {id === "win" ? <WindowsLogoIcon size={21} /> : <AppleLogoIcon size={21} />}
                {option.label}
              </button>)}
          </div>
          <div className="download-requirements">
            <strong>
              {selectedDownload.system}
            </strong>
            <p>{t("轻量配音最低需 8 GB 内存；标准配音、人物创作与声音克隆至少需 16 GB，可通过配置检测了解本机条件。 首次准备标准功能建议预留至少 ")}{selectedDownload.disk}{t(" GB，四个基础资源包约需预留 ")}{selectedDownload.allDisk}{t(" GB；以软件检测结果为准。 运行组件与所需声音包首次需联网准备，完成后可离线配音。")}</p>
            {downloadPlatform === "win" ? <p className="release-note">{t("当前 Windows 安装版使用 CPU，不含 CUDA 加速；已完成打包检查，安装与推理仍待 Windows 实机验收。暂不支持 Windows ARM。")}</p> : <p className="release-note">{t("先将声悦拖入“应用程序”再打开。当前安装包未经 Apple 公证，首次打开可能需要在“系统设置 → 隐私与安全性”中确认。")}{downloadPlatform === "intel" && t(" Intel 版使用 CPU，推理速度与完整功能仍需 Intel 实机验收；M 系列 Mac 请选 Apple 芯片版。")}
              </p>}
          </div>
          <a className="button primary download-file" href={`/downloads/Shengyue-${release.version}-${selectedDownload.suffix}`} download>
            <DownloadSimpleIcon size={20} />{t("下载")}{" "}
            {selectedDownload.download}{t(" 安装包")}<ArrowRightIcon size={18} />
          </a>
          <a className="download-checksums" href="/downloads/SHA256SUMS.txt" target="_blank" rel="noreferrer">v{release.version}{t(" · 查看安装包 SHA-256 校验值")}</a>
          <small className="dialog-bottom">{t("安装包包含免费 CLI。首次启动先检查配置并下载模型。安装或使用遇到问题，可")}<a href={contactHref(locale)} onClick={contactFromDownload}>{t("扫码联系客服")}</a></small>
        </div>
      </dialog>
      <dialog ref={galleryDialog} className="gallery-dialog" aria-label={t("真实产品界面")} onClose={() => setGalleryOpen(false)} onClick={e => {
      if (e.target === e.currentTarget) setGalleryOpen(false);
    }}>
        <div className="gallery-toolbar">
          <div className="filter-tabs">
            {productScreens.map(({
            id,
            label
          }) => <button key={id} className={gallery === id ? "selected" : ""} aria-pressed={gallery === id} onClick={() => setGallery(id)}>
                {label}
              </button>)}
          </div>
          <button className="dialog-close" aria-label={t("关闭产品预览")} onClick={() => setGalleryOpen(false)}>
            <XIcon size={22} />
          </button>
        </div>
        <img src={`/assets/${gallery}.png`} alt={galleryScreen.alt} width="2840" height="1610" loading="lazy" />
        <p className="gallery-caption">v0.4.6{t(" Mac 版真实界面 · 使用示例文稿展示")}</p>
      </dialog>
      <div className={`toast ${toast ? "visible" : ""}`} role="status">
        {toast && <>
            <CheckIcon size={18} />
            {toast}
          </>}
      </div>
    </>;
}
