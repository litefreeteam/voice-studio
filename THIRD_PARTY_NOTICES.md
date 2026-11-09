# Third-party notices

Shengyue Voice source: MIT, see LICENSE.

- Qwen3-TTS: Copyright Qwen contributors. Apache License 2.0. https://github.com/QwenLM/Qwen3-TTS
- Qwen3-TTS CustomVoice (1.7B / 0.6B), VoiceDesign and Base weights, and their MLX conversions: Apache License 2.0. Models are downloaded from pinned ModelScope mirrors, HF-Mirror or the original Hugging Face repositories, with accompanying metadata and license notices where provided. File content is checked against the bundled SHA-256 manifest.
- VoxCPM2: Copyright 2026 OpenBMB. Apache License 2.0. https://github.com/OpenBMB/VoxCPM . Optional model weights and their MLX conversion are installed only on explicit request, with pinned per-file ModelScope revisions and SHA-256 verification. The unmodified inference subset is bundled under backend/vendor/voxcpm; its full license, source revision and per-file hashes are retained in LICENSE and UPSTREAM.json.
- MLX Audio: MIT. https://github.com/Blaizzy/mlx-audio
- Faster Whisper: MIT. https://github.com/SYSTRAN/faster-whisper . Used for optional, local reference transcription on CPU; no cloud speech service is called.
- Whisper Small and its CTranslate2 conversion: MIT. https://github.com/openai/whisper and https://huggingface.co/Systran/faster-whisper-small . Optional model files are pinned and SHA-256 verified using shared/transcription-manifest.json.
- CTranslate2: MIT. https://github.com/OpenNMT/CTranslate2 . Installed unmodified with upstream license files.
- PyAV: BSD-3-Clause. https://github.com/PyAV-Org/PyAV . Its binary distribution also includes FFmpeg libraries, whose upstream licenses and notices remain in the installed distribution. https://ffmpeg.org/legal.html
- uv: Copyright Astral Software Inc. and contributors. Distributed under MIT OR Apache-2.0. Both license texts are included with the bootstrap binaries.
- Electron: MIT. Electron and Chromium notices are included in the Electron distribution shipped with this app.
- Lucide icons: ISC; Feather-derived icons: MIT. Copyright Lucide Contributors and Cole Bemis. https://lucide.dev/license . Full license text is included at ui/assets/icons/LICENSE.
- Phosphor activation icons: MIT. Copyright Phosphor Icons. Full license text is included at ui/assets/icons/activation/LICENSE.
- PyTorch: BSD-style. Installed at first setup; license files are retained in the Python package distribution.
- Microsoft Visual C++ v14 Redistributable x64: Copyright Microsoft Corporation. The Windows Setup installer includes Microsoft's original, unmodified redistributable and runs it as a system prerequisite. Microsoft Software License Terms apply independently. https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist . Its system installation is retained when Shengyue is uninstalled because other applications may use it.
- SoundFile / libsndfile: BSD / LGPL-2.1-or-later. Installed with upstream license files.
- cryptography: Apache-2.0 OR BSD-3-Clause. Used for independent offline Ed25519 verification; upstream license texts are retained in the installed package. https://cryptography.io/
- lameenc / LAME: LGPL-3.0-or-later (binding) / LGPL-2.0-or-later (encoder). Dynamically loaded Python packages are installed at runtime from PyPI, with license files retained. Source: https://github.com/chrisstaite/lameenc and https://lame.sourceforge.io/

Python dependencies are installed as separate, unmodified distributions in the user's local runtime; their dist-info licenses and source links remain available. Their licenses apply independently. Model and library authors do not endorse this application.
