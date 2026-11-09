"""Synchronize the website's actual voice catalog, recordings and waveform data."""
import json
from pathlib import Path
import shutil
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / "shared/catalog.json").read_text("utf-8"))
waveforms = {}
for voice in catalog["voices"] + catalog["characters"]:
    for relative in [voice["preview"]["file"], voice["portrait"]]:
        source = root / "ui" / relative
        destination = root / "website/public" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    audio, _ = sf.read(root / "ui" / voice["preview"]["file"])
    peaks = np.array([np.max(np.abs(frame)) for frame in np.array_split(audio, 96)])
    waveforms[voice["id"]] = [round(float(value), 4) for value in peaks / max(float(peaks.max()), 1e-6)]
shutil.copy2(root / "shared/catalog.json", root / "website/src/catalog.json")
shutil.copy2(root / "ui/assets/previews/manifest.json", root / "website/public/assets/previews/manifest.json")
shutil.copy2(root / "ui/assets/contact-qr.png", root / "website/public/assets/contact-qr.png")
(root / "website/src/waveforms.json").write_text(json.dumps(waveforms, separators=(",", ":")) + "\n", "utf-8")
print(f"Synchronized {len(waveforms)} voices and {len(catalog['templates'])} templates")
