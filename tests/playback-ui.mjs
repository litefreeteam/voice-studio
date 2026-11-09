import assert from 'node:assert/strict';

// Verify the visible indicator, not just an ARIA flag or an animation class.
export async function assertSound(page, selector, phase = 'playing') {
  await page.waitForFunction(({ selector, phase }) => document.querySelector(selector)?.dataset.soundState === phase, { selector, phase });
  const control = page.locator(selector).first();
  if (phase === 'playing') {
    assert.equal(await control.locator('.sound-wave i').count(), 4);
    assert.equal(await control.locator('.sound-wave').evaluate(wave => { const r = wave.getBoundingClientRect(); return getComputedStyle(wave).display === 'flex' && r.width > 0 && r.height > 0; }), true, `${selector} has a visible sound wave`);
    const before = await control.locator('.sound-wave i').first().evaluate(bar => getComputedStyle(bar).transform);
    await page.waitForFunction(({ selector, before }) => getComputedStyle(document.querySelector(selector + ' .sound-wave i')).transform !== before, { selector, before }, { timeout: 3000 });
  } else {
    assert.equal(await control.locator('.sound-wave').evaluate(wave => getComputedStyle(wave).display), 'none', `${selector} stops moving when audio is ${phase}`);
  }
}
