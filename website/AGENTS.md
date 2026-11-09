# Prototype Instructions

## Selected product direction

The user chose a combination of the first dark violet infinity-wave concept and the second light creator-focused concept. The combined visual target is `design/selected-hybrid.png`. Use a dark hero with airy animated sound waves, warm ivory audition section with actual product portraits and audio, and pale lavender product proof section. The brand is 声悦配音. Claims: paid activation is required before entering the desktop workspace or using CLI features; no free generation trial; a device-bound professional license removes generation count limits; offline generation after online setup; Agent integration via local CLI. Do not invent prices, token savings percentages, MCP integration, or real-time conversation.

This website is independent of the parent Electron app. Do not modify parent application files for marketing work.

## Accepted refinement

The latest user feedback (2026-10-09) replaces both the previous sonic S logo and the spherical particle animation. Use a simple unboxed sound-wave mark (`public/assets/brand-wave.svg`, derived from Phosphor Waveform) consistently in the header, footer, product flow, download dialog, and favicon. Under the Chinese wordmark, use exactly “好声音，让表达更动人” instead of the English subline.

The latest refinement rejects the thin flowing lines. The hero should be cute, natural, beautiful, bouncing **particles**, arranged as five soft rounded sound-wave columns echoing the logo. Use fine glowing particles with organic spacing and gentle staggered breathing; follow the latest size and palette refinement below. Do not restore the dense sphere, a wire mesh, infinity ring, or thin continuous lines. Pointer movement or keyboard focus should gently part nearby particles and highlight them; leaving should settle smoothly. Continue code-native WebGL motion, real audition audio response, pause/resume, reduced-motion support, and rendering suspension offscreen or in hidden tabs. Keep the rest of the selected layout.

The subsequent refinement requests finer particles, slower motion, and a clean, healing, clear palette. Keep the five-column silhouette, but use small, consistently sized, well-separated dots with minimal drift. Use a restrained, clean, fresh palette without peach, gold, or warm speckled highlights. Idle breathing should take roughly 7 seconds per cycle, with smaller amplitude and softer hover response; keep loose background points sparse. Match the local glow and audition controls to this palette.

The newest feedback asks for nearly mist-sized particles, or just slightly larger, and fresher, cleaner colors. Use very fine soft points with a narrow size range and enough density to preserve the five-column silhouette, while retaining slow motion. Use a delicate ice-blue-to-pale-mint transition with airy white highlights; match the local glow and audition control to it. Avoid restoring coarse bright dots or multicolor speckling.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

The user found the desktop hero typography oversized and the first screen poorly balanced. Keep a calmer hierarchy: desktop heading tops out at 60px with both lines the same size and weight 700, supporting text around 19px, and a 54px-high primary CTA. Use muted lavender emphasis and softer supporting text. Keep a clear gap between the copy and the mist waveform, align their visual centers, and use a 600px desktop hero rather than the previous 650px section. Do not restore the 96px/80px title or oversized CTA.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

The latest selected visual (2026-10-10) is the user's attached full-hero reference, saved as design/selected-particle-wave.png. It overrides the cloud mascot, female portrait and old five-column directions. Match the wide, airy, undulating particle sound wave: an ice-blue/white luminous core with delicate lavender secondary ribbons and gradually scattered edges. Particles must be individually clear and attractive, not a grainy solid mass or continuous lines. Render independent WebGL POINTS with code-native slow flow, gentle local pointer displacement and actual audition RMS response. Keep pause/resume, reduced-motion, offscreen/hidden-tab suspension and a static particle fallback. At large desktop sizes the effect spans about 850px to the right, with clear separation from the text. The caption returns to “每一句表达，都有自己的回响。” and the button to “听见声音的心跳”. Preserve the refined hero typography/layout. Rejected portraits, cloud toys, spheres and five-column images are historical, not future visual references.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Paid activation (2026-10-10)

The user requires purchase and activation before using the software. Remove trial CTAs, generation credits, and free-experience language. Website audio samples remain available before purchase. Until real sales/contact details are supplied, explain that customers purchase through the distributing sales channel and send the device code plus order information to receive a signed offline activation code. Do not invent purchase links, contact details or prices. Download links must use the new v0.3.1 activation-required builds, which include CLI.

## Course narration (2026-10-10)

The user wants “AI 批量课程配音” explicitly included in marketing and software feature descriptions. Present online courses, company training and tutorials as a supported scenario using existing text/script batching, saved instructor voices, per-segment regeneration and WAV / MP3 / ZIP export. Keep limits accurate: at most 5,000 characters and 100 segments per task; long courses require multiple batches, generated sequentially on the local computer. Do not imply automatic PPT/PDF extraction, video production, simultaneous inference, or unlimited text per task. App changes for this request are explicitly authorized by the user alongside website copy changes.

## Expanded voices and templates (2026-10-10)

The user refined the website audition cards on 2026-10-21: make them smaller and more delicate. Use compact horizontal cards with small inset character portraits, restrained type and spacing, and the voice information and real waveform alongside the portrait. Keep three columns on desktop, two on tablets and short single-column cards on phones. Preserve the six initial voices, progressive reveal, filters, original portrait/audio assets and accessible playback/seek controls. This supersedes the earlier oversized portrait-card sizing in design QA history.

The subsequent refinement on 2026-10-21 removes duplicate playback controls: portraits are static images without overlay play buttons or click actions. Keep one playback button beside the waveform, reduced to 32 px with a 15 px icon and a muted pale lavender/gray treatment. Hover should stay soft without bright purple fills or scaling.

The user requested further expansion and tuning. Current software includes 36 voice choices: 9 fixed voices and 27 voice-design presets, plus 20 creation templates in five categories. Keep these distinctions accurate; use shared catalog counts. Every voice has a bundled real audition and an original fictional character illustration. On 2026-10-10, the user requested avatars for the expanded voices; all 15 new presets now use dedicated 384 × 384 WebP portraits in the existing warm editorial illustration style, replacing SVG voice identity tiles in catalog references. The website catalog, portraits, previews and real waveform data are synchronized with scripts/sync-website-assets.py. Course audition surfaces specialized instructor voices first. Show six voices initially and progressively reveal more, preserving the existing visual design and particle hero.

The expanded release is v0.3.2; download links and prepared installers must use this version. Preserve v0.3.1 release originals while updating website download copies.

## Additional adult voices (2026-10-15)

The shared catalog now includes 42 voice choices: 9 fixed voices and 33 voice-design presets. Six new Mandarin adult presets (清舟、怀瑾、闻岳、沐言、南絮、颂雅) have real bundled auditions and dedicated original illustrated portraits. Preserve catalog-driven counts and synchronize website assets with scripts/sync-website-assets.py. Voice designs remain variable; a preview is an example, and users choose a fixed sample for their own work.

## Retuned child auditions (2026-10-15)

The four child auditions (乐乐、小雨、豆豆、果果) and 亦辰 were replaced, preserving IDs and counts. Their catalog reference metadata identifies the curated sample reused by default fixed-voice creation. Existing project anchors retain their voices; custom descriptions or unlocked designs remain variable. Sixteen older auditions were level-matched. Preserve these distinctions and avoid promising exact ages or human listening certification.

## Contextual auditions (2026-10-16)

Auditions must start directly with realistic scenario content, without greetings, voice self-introductions, or promises to tell a story. Use actual lesson explanations, original fiction excerpts, podcast discussion, character dialogue, instructions and advertising copy. The course-batch template now defaults to 沐言 (clear-female), with a rectangle-area lesson and a curated bundled sample reused for new fixed voices. Surface this voice first in the course audition group. Synchronize all catalog, audio and waveform changes with scripts/sync-website-assets.py.

## ECS deployment (2026-10-20)

The user authorized deploying this website to their own server (`ssh freeteam-ecs`, `139.224.83.72`) and replacing unnecessary legacy services. Use `https://voice.freeteam.top/` as the canonical site; `freeteam.top` redirects there. The site needs only static Nginx hosting. The server also hosts other domains, so keep their existing Nginx configuration and services intact. Deploy through `scripts/deploy-ecs.sh` with timestamped releases and an atomic current symlink; see README.md for paths, certificate renewal and rollback. Customer downloads and footer use `src/release.json` (currently v0.4.6); the preparation script verifies pinned SHA-256 values. Publish only customer installers, never seller tools, private keys or activation materials.

## Published-content audit (2026-10-20)

Ground customer claims in the actual downloadable v0.4.6 bundles, not only newer unbuilt source. Keep the particle hero and selected visual design. Current genuine Mac screenshots are `public/assets/{workspace,project,voice-library,creator-home}-0.4.6.png`; they use an isolated profile with fictional sample text. Do not restore the v0.3.1 / 21-voice screenshots. The website's newer audition texts are valid generated examples but differ from some bundled auditions; disclose that actual output depends on the local trial and fixed sample.

Downloads include Apple Silicon Mac, Intel Mac and Windows x64. macOS requires 14+; Windows requires 10 2004 / build 19041 or later and x64, not Windows ARM. Light mode needs at least 8 GB RAM; other modes need at least 16 GB. Fresh standard preparation reserves 13 GB on Apple Silicon and 17 GB on CPU platforms; all four base packages reserve 25 / 41 GB. Final requirements come from the software's own check. Intel and Windows bundles use CPU, with native acceptance still pending.

The unactivated gate permits hardware checks and fixed compatibility trials, not editable generation or customer exports. Explain this exception without advertising a general free trial. Purchase remains via the original sales channel; request device code and order details there, never invent a store, contact or price. CLI catalog/setup/generation remain activation gated.

v0.4.6 projects support DOCX/PPTX text import, chapters/roles, up to 10,000 lines / 500,000 characters, waveform editing, take selection, local reference transcription, background mixing and merged WAV/MP3/SRT export. PPTX reads notes first, then page text; no OCR or PDF. Quick tasks and CLI retain 5,000-character / 100-segment limits; CLI segments max 600 characters. Project splitting is automatic. SRT timings follow generated segments, not word recognition. CLI ordinary ZIP does not perform project mixing or subtitle export. Standard preset voices support per-line expression; locked design and reference voices inherit their sample expression in this published build. Do not advertise the later source's optional expressive package until it is included in downloadable installers. Public CLI docs must use generic paths and match the released `describe` protocol.

## SEO implementation (2026-10-20)

Production pages are statically rendered by `scripts/prerender.mjs` from the same React components. Preserve complete HTML and matching homepage hydration; never revert to an empty app shell. Keep download links usable without JavaScript. The download page and three substantive guides use real paths, individual metadata, canonical URLs, structured data, and crawlable internal links. `src/site-content.mjs` is the production metadata/content source. Update content dates only on actual changes. Do not fabricate prices, reviews, search volumes, ranking promises, or search-platform verification codes. Run both `npm run test:seo` and `npm run test:sites` after building and before deployment. Keep the existing Sites handoff files intact; live ECS uses Nginx with real 404 responses.

Search ownership configuration lives in `search-verification.json`; retain every actual Google/Baidu token across builds. Empty arrays mean no account has been verified, never a successful connection. Keep the IndexNow ownership key stable and its root proof file available. Post-deploy notifications are content-based and deduplicated; a 202 response means received with key validation pending, never confirmed indexing. Do not confuse IndexNow with Google/Baidu webmaster account setup. The user wants the agent to finish technical setup and handle verification/submission after their own account login; avoid asking them to edit DNS, code or server files when HTML-tag verification suffices.

Google URL-prefix ownership is verified using the real token in the configuration; its sitemap has been successfully processed with 5 discovered URLs. Baidu ownership is also verified using its real HTML token, deployed in release `20261020T101848Z`; category is Information Technology. Preserve both tokens. The human completed Baidu's second CAPTCHA; the manual form reset, but no persistent success receipt was observed. Baidu's sitemap tool currently has quota 0 and a disabled input. Its official push API returns HTTP 400 with `site init fail`, so URL acceptance is unconfirmed. Private push credentials are in ignored `.qa/seo/baidu-auth.json`, never public assets or source metadata. The post-deploy `seo:submit:baidu` script records success only on an explicit full acceptance response; errors must not break publishing. Do not repeat failed pushes in a tight loop, request further CAPTCHAs without a concrete need, or equate submission/discovery with indexing.

## Bilingual site and contact (2026-10-20)

The user supplied `freeteamlite@gmail.com` for public website contact. Use it for purchase questions, installation help, activation and feedback, with clickable mailto links in the contact section and all page footers. Do not send test emails or promise response times. Keep existing seller-based fulfillment and device-bound activation truthful; no online checkout or price was supplied.

The user requested Chinese and English pages, translating website elements first while leaving audio material untouched. Preserve Chinese routes at `/` and publish corresponding English routes under `/en/`, including the download page and all three guides. Each page has a reciprocal language switch, self canonical, zh-CN/en/x-default alternatives and locale metadata; all ten pages appear in the sitemap. Render each language to complete static HTML and hydrate each homepage with the matching locale. Keep existing Google/Baidu verification and stable IndexNow proof.

Use `src/i18n.mjs` and `src/locales/en.json` for interactive UI, labels, accessibility text and voice metadata; use `src/site-content.en.mjs` for English articles and metadata. English brand is Shengyue Voice. Keep the Chinese tagline exactly as specified above. Never translate executable filenames in runnable CLI commands. The English page links to a separate English JSON script example; the full existing downloadable CLI reference remains Chinese and must be labeled accordingly.

Do not replace, regenerate, reorder or edit audio files, sample transcripts or waveform data for localization. English voice labels are translated, and original spoken scripts remain labeled by their audio language. Product screenshots and the downloadable v0.4.6 app keep their actual Chinese interface; English pages explain this rather than advertising an English desktop UI. The selected particle hero remains intact, with English mobile copy and animation laid out separately to prevent overlap.

## Compact language control (2026-10-20)

The user wants language selection behind an icon dropdown rather than two inline text links. Use a compact globe-and-chevron disclosure in the header on every page, with Chinese/English options and a check on the current language. Retain real links to the corresponding page, all hreflang metadata, and a useful native disclosure without JavaScript. A small shared progressive-enhancement script adds outside-click and Escape dismissal on both hydrated homepages and static guides/downloads. Keep keyboard focus visible and the touch target at least 42 px high. Preserve the selected hero, email and all audio assets.

The user refined the placement on 2026-10-21: keep the language control at the far right of the header on Chinese and English homepages, download pages and guides, including mobile layouts. Place it after the other header controls, never between the brand and navigation or in the center.

## PayPal notification service (2026-10-21)

The user authorized developing and starting a simple server-side receiver at `https://voice.freeteam.top/api/paypal/webhook`. Keep it independent from static marketing builds: source in `paypal/`, deploy with `scripts/deploy-paypal.sh`, systemd service `shengyue-paypal`, loopback port 3087, private data in `/var/lib/shengyue-paypal`. Configuration is `/etc/shengyue-paypal.env`; preserve it across deployments. Until a real PayPal Webhook ID is configured, received notifications must stay explicitly unverified and must not trigger order fulfillment or license issuance. Do not expose payment records, credentials or activation tools as static assets. See `paypal/README.md` for signature verification, runtime compatibility and operations.

## PayPal website order numbers (2026-10-21)

The user supplied live hosted Buy Now button `9CXPDVNDNZXJ2` and confirmed it sells a Shengyue Pro perpetual device-bound license for USD 19.00. Product configuration is shared in `paypal/product.json`. The bilingual homepage purchase section collects email, device code and the customer's compatibility-test acknowledgement, saves an immutable server order through `/api/paypal/orders`, then passes the server-issued order number as both `invoice` and `custom`. Preserve the same idempotency key across retries and page reloads. Orders and customer details remain private, outside static releases; access requires the browser's random bearer key. No browser return, acknowledgement or unverified notification confirms payment. Compatibility acknowledgement is not a validated detection report. Codes currently require manual payment/report verification through the contact email. Hosted Payments Standard uses IPN, separate from the existing REST webhook receiver; this change does not implement IPN fulfillment or email sending. Preserve the USD 19.00 order snapshot for later amount verification.

## Automatic license email (2026-10-21)

The user authorized automatic issuance and email delivery after verified payment, reusing JobWin's Aliyun SMTP account. Preserve `/etc/shengyue-paypal-mail.env` (root-only); never commit credentials. The user confirmed the PayPal receiving email is `zhangbing1003@gmail.com`. This supersedes the earlier manual-only order flow. The common notification URL now verifies hosted-button IPN against PayPal's fixed HTTPS endpoint using original bytes; REST JSON still requires a real Webhook ID. Match receiver, order, amount, currency, quantity and transaction. New purchase forms collect a full compatibility report checked by the existing shared validator; legacy orders without one stay under manual review. Reuse the original private key in `/etc/shengyue-paypal/signing-key.pem` and unchanged desktop license functions. Keep private durable retry state and reuse the same license/Message-ID on retries. Never issue production licenses for sandbox events. SMTP acceptance is not proof of inbox delivery. Do not send test emails without a user request.

## Voice cloning terminology (2026-10-21)

The user wants the feature previously called “声音复用” to be named “声音克隆”. Use “声音克隆” in Chinese product copy and “Voice cloning” in English. This is a terminology change; preserve existing model/package IDs and the actual behavior of reusing saved character samples.

## Optional compatibility checks (2026-10-21)

The user removed mandatory pre-purchase compatibility checks and reports. Checkout collects only email and device code; no acknowledgement or report is required to order, manually issue a code or fulfill verified payment. This supersedes the report prerequisite in Automatic license email above. Compatibility checks remain an optional troubleshooting tool. Preserve legacy request fields and normalization order for idempotent retries. Resume historical verified-payment jobs held solely for `compatibility_report_required`; preserve all other review reasons, payment validation, receiver/amount/device binding checks, sandbox restrictions and email security.

## Shared QR contact channel (2026-10-21)

The user supplied a WeChat contact QR image and requires every contact entry in the desktop client and website to use this same image. Preserve the original PNG bytes in `ui/assets/contact-qr.png` and `website/public/assets/contact-qr.png`; never redraw or regenerate the QR code. Contact links, footers, purchase support and guides route to the localized homepage `#contact`, where the code is visible and downloadable. The desktop activation, purchase help and settings share one local, offline-capable QR dialog. This supersedes the public email contact requirement above. Checkout still collects the customer email for activation-code delivery; SMTP configuration and reply-to are operational mail settings. Keep both language variants and static no-JavaScript contact access.

## Rebuilt installers (2026-10-21)

The user requested all Mac and Windows packages rebuilt and uploaded. The current release is v0.4.7, with DMG and ZIP for Apple Silicon and Intel Macs, and Setup plus ZIP for Windows x64. Keep all six installer SHA-256 values in src/release.json and expose ZIP alternatives on the download page. Compatibility inspection is optional and checks only configuration, environment, local resource status and resource endpoint connectivity; it never installs resources, starts TTS or requires listening confirmation. Existing v0.4.6 screenshots must keep their actual version labels until recaptured. Windows Setup rejects unsupported OS versions and architectures before touching prerequisites or older installations. Report native Windows test coverage honestly; no hosted runner was assigned in the attempted validation run.

## Google Analytics (2026-10-22)

The user requested Google Analytics for the public website. Preserve the real GA4 measurement ID `G-N81S6342EF` and Web stream `16178106504` in the existing user's account; do not create duplicate resources. `analytics.json` and the prerendered shared script cover all ten language routes. Collect only page traffic and the explicit preview/download/purchase-action events documented in README.md. Never read or send customer form values, device codes, order IDs, activation data or arbitrary URL query parameters. Keep Google Signals and advertising features disabled, and turn off enhanced measurement to avoid automatic form collection and duplicate events. Local previews must not send production analytics. This authorization applies to the website; do not add telemetry to the desktop application. Build and run `test:analytics`, `test:seo` and `test:sites` before ECS publication.

## Selected conversational Nanxu (2026-11-09)

The user rejected the slow, unnatural Nanxu experiment and selected round 2 candidate B. The shared `warm-female` preset now uses the exact selected recording for both its audition and bundled reference. Preserve its relaxed conversational delivery and synchronized transcript, hashes and waveform; there are 42 choices and 7 curated design references. Existing saved voice anchors retain their identity. Keep published installer claims tied to the actual released artifacts.


## Free release (2026-11-09)

The user changed the current release to a free edition. This supersedes all paid activation and checkout requirements above: desktop, Python engine and CLI require no purchase, device code or activation. First launch checks configuration and offers model/runtime downloads, including a light option for 8 GB computers. Remove purchase navigation, PayPal checkout, license-price calculators and paid claims from both language variants, downloads, guides and SEO metadata. Keep historical payment records and fulfillment intact. Rebuild all six customer artifacts as v0.4.8, pin their actual SHA-256 values and deploy using the existing ECS workflow. Preserve existing user data, original contact QR, audio and search ownership configuration.

## Open-source repository and stars (2026-11-09)

The user wants the public GitHub repository `https://github.com/litefreeteam/voice-studio` linked from the website with its star count. Keep the shared GitHub entry in headers and footers across Chinese and English pages. Fetch real counts from GitHub's public repository API and cache for one hour; show a neutral “Star” fallback on failures, never invent a count. Preserve a working link without JavaScript, compact mobile controls, and the language picker at the far right. The shared counter renders in a shadow root so updates cannot interfere with homepage React hydration.
