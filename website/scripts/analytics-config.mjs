import { readFile } from 'node:fs/promises';

export async function analyticsTag() {
  const config = JSON.parse(await readFile(new URL('../analytics.json', import.meta.url), 'utf8'));
  if (!/^G-[A-Z0-9]{10}$/.test(config.measurementId) || config.hostname !== 'voice.freeteam.top') {
    throw new Error('Invalid production Google Analytics configuration');
  }
  return `<script src="/assets/analytics.js" data-measurement-id="${config.measurementId}" data-hostname="${config.hostname}" defer></script>`;
}
