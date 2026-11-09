"""Deterministic desktop test worker. No models, network or production data."""
import json
import math
import os
import struct
import sys
import time
import uuid
import wave
import io
import base64
import hashlib
import zipfile
import shutil
from pathlib import Path

root = Path(sys.argv[sys.argv.index("--data-dir") + 1])
history = []


def emit(kind, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False), flush=True)


emit("ready")
for line in sys.stdin:
    request = json.loads(line)
    data = request.get("data", {})
    try:
        if request["op"] == "status":
            try:
                history = json.loads((root / "history.json").read_text())
            except FileNotFoundError:
                pass
            references = json.loads((root / "references.json").read_text()) if (root / "references.json").exists() else []
            result = {"history": history, "references": references, "modelReady": True,
                      "packages": [{"id": key, "ready": True} for key in ["standard", "light", "character", "reference"]]}
        elif request["op"] == "prepare-voice":
            identity = [data.get(key) for key in ("projectId", "roleId", "character", "voiceDescription", "voiceRevision", "emotion", "pace", "instruction")]
            anchor_id = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
            source = io.BytesIO()
            with wave.open(source, "wb") as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
                wav.writeframes(b"\0\0" * 2400)
            result = {"voiceAnchorId": anchor_id, "text": "角色声音试听。", "duration": .1, "audio": base64.b64encode(source.getvalue()).decode()}
            with (root / "test-voice-setup.jsonl").open("a") as file:
                file.write(json.dumps(data, ensure_ascii=False) + "\n")
        elif request["op"] == "generate":
            rows = data["rows"]
            assert 1 <= len(rows) <= 100
            assert sum(len(row["text"]) for row in rows) <= 5000
            assert all(len(row["text"]) <= 600 for row in rows)
            with (root / "test-calls.jsonl").open("a") as file:
                file.write(json.dumps(rows, ensure_ascii=False) + "\n")
            items = []
            for index, row in enumerate(rows):
                emit("progress", stage="generating", current=index + 1, total=len(rows))
                time.sleep(0.003)
                options = {**data, **row}
                options.pop("rows", None)
                folder = root / "outputs" / uuid.uuid4().hex
                folder.mkdir(parents=True)
                filename = row.get("filename", "voice")
                with wave.open(str(folder / (filename + ".wav")), "wb") as audio:
                    audio.setparams((1, 2, 24000, 2400, "NONE", "not compressed"))
                    audio.writeframes(b"".join(struct.pack("<h", int(2000 * math.sin(2 * math.pi * 440 * i / 24000))) for i in range(2400)))
                (folder / (filename + ".mp3")).write_bytes(b"test fixture audio")
                item = {"id": folder.name, "text": row["text"], "wav": filename + ".wav", "mp3": filename + ".mp3",
                        "voiceName": options.get("voiceName", "fixture"), "project": options.get("project", ""),
                        "speaker": options.get("speaker", "Vivian"), "duration": 0.1, "createdAt": int(time.time() * 1000),
                        "options": options}
                (folder / "metadata.json").write_text(json.dumps(item, ensure_ascii=False))
                history.insert(0, item)
                (root / "history.json").write_text(json.dumps(history, ensure_ascii=False))
                emit("progress", stage="clip", item=item)
                items.append(item)
            result = {"items": items}
        elif request["op"] == "reference-open":
            token = uuid.uuid4().hex; folder = root / '.reference-imports' / token; folder.mkdir(parents=True)
            shutil.copyfile(data['path'], folder / 'audio.wav')
            with wave.open(str(folder / 'audio.wav')) as source: duration = source.getnframes() / source.getframerate()
            result = {'token': token, 'name': Path(data['path']).stem, 'duration': duration, 'quality': {'messages': []}, 'transcription': {'ready': False, 'bytes': 486000000}}
        elif request["op"] == "reference-cancel":
            shutil.rmtree(root / '.reference-imports' / data['token'], ignore_errors=True); result = {'cancelled': True}
        elif request["op"] == "reference-commit":
            references = json.loads((root / "references.json").read_text()) if (root / "references.json").exists() else []
            result = {'id': uuid.uuid4().hex, 'name': data['name'], 'text': data['text'], 'duration': (data['endMs'] - data['startMs']) / 1000, 'language': 'Chinese'}
            (root / 'references').mkdir(exist_ok=True)
            with wave.open(str(root / '.reference-imports' / data['token'] / 'audio.wav')) as source:
                source.setpos(round(data['startMs'] / 1000 * source.getframerate()))
                frames = source.readframes(round(result['duration'] * source.getframerate())); params = source.getparams()
            with wave.open(str(root / 'references' / (result['id'] + '.wav')), 'wb') as target:
                target.setparams(params); target.writeframes(frames)
            references.append(result); (root / 'references.json').write_text(json.dumps(references, ensure_ascii=False))
            shutil.rmtree(root / '.reference-imports' / data['token'])
        elif request["op"] == "reference":
            references = json.loads((root / "references.json").read_text()) if (root / "references.json").exists() else []
            result = {"id": uuid.uuid4().hex, "name": data["name"], "text": data["text"], "duration": 3, "language": "Chinese"}
            references.append(result)
            (root / "references.json").write_text(json.dumps(references, ensure_ascii=False))
        elif request["op"] == "zip":
            known = {item["id"]: item for item in history}
            items = [known[key] for key in data["ids"]]
            token = uuid.uuid4().hex
            folder = root / ".export-tmp" / ("voice-export-" + token)
            folder.mkdir(parents=True)
            (folder / "owner.json").write_text(json.dumps({"schema": "shengyue-export-v1", "token": token, "pid": os.getppid()}))
            destination = folder / "archive.zip"
            with zipfile.ZipFile(destination, "w") as archive:
                for index, item in enumerate(items):
                    archive.write(root / "outputs" / item["id"] / item[data["format"]], str(index) + "-" + item[data["format"]])
                archive.writestr("manifest.json", json.dumps(items, ensure_ascii=False))
            result = {"path": str(destination), "count": len(items)}
        else:
            raise ValueError("Unexpected test action: " + request["op"])
        emit("result", id=request["id"], result=result)
    except Exception as error:
        emit("error", id=request["id"], message=str(error))
