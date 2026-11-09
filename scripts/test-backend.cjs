const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const local = path.join(__dirname, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
