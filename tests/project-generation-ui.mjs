import assert from 'node:assert/strict';
import path from 'node:path';

// Keep execution unresolved so a fast test backend cannot hide the pending state.
export async function testProjectGeneration({ page, queue, executions, clip, artifacts }) {
  const choose = (selector, value) => page.locator(selector).evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await page.locator('[data-view="projects"]').click();
  const projectId = await page.evaluate(async () => {
    const project = ScriptProjects.create('生成按钮状态检查');
    project.chapters[0].lines = ['第一句正在生成。', '第二句还在队列中。'].map(text => ScriptProjects.line(text, project.roles[0].id));
    project.chapters.push({ id: crypto.randomUUID(), name: '第2章', lines: [ScriptProjects.line('这一章暂时不生成。', project.roles[0].id)] });
    await studio.invoke('project-save', project); await projectWorkspace.open(project.id); return project.id;
  });
  const generate = page.locator('#project-generate');
  await generate.click();
  await page.waitForFunction(() => document.querySelector('#project-generate').dataset.generationState === 'running');
  assert.match(await generate.textContent(), /生成中 · 0\/2/);
  assert.equal(await generate.isDisabled(), true);
  assert.equal(await generate.getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.project-line-generate[aria-busy="true"]').count(), 2);
  const assertAnimation = async selector => {
    const first = await page.locator(selector).first().evaluate(node => node.getAnimations().map(animation => ({ name: animation.animationName, time: animation.currentTime })));
    assert.ok(first.some(animation => animation.name === 'project-generation-wave'), 'generation has a real running CSS animation');
    await page.waitForFunction(({ selector, time }) => [...document.querySelectorAll(selector)].some(node => node.getAnimations().some(animation => animation.currentTime > time)), { selector, time: first[0].time });
  };
  await assertAnimation('#project-generate .generation-wave i');
  await assertAnimation('.project-line-generate .generation-wave i');
  await page.screenshot({ path: path.join(artifacts, 'project-generating.png') });
  for (const width of [960, 850]) {
    await page.setViewportSize({ width, height: 600 });
    const fits = await generate.evaluate(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    });
    assert.equal(fits, true, `the animated progress button fits a ${width}px window`);
  }
  await page.screenshot({ path: path.join(artifacts, 'project-generating-small.png') });
  await page.setViewportSize({ width: 1360, height: 900 });

  const active = queue.snapshot().jobs.at(-1), execution = executions.at(-1), submitted = queue.snapshot().jobs.length;
  await generate.evaluate(button => button.click());
  assert.equal(queue.snapshot().jobs.length, submitted, 'the generating button cannot submit duplicates');
  const items = execution.data.rows.map((row, index) => ({ ...clip, id: 'project-state-' + index, text: row.text, options: { ...execution.data, ...row, rows: undefined } }));
  queue.acceptProgress({ stage: 'clip', item: items[0] });
  await page.waitForFunction(() => document.querySelector('#project-generate').textContent.includes('1/2'));
  assert.equal(await generate.getAttribute('aria-busy'), 'true');
  await page.reload();
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="projects"]').click();
  await page.evaluate(id => projectWorkspace.open(id), projectId);
  assert.match(await generate.textContent(), /生成中 · 1\/2/);
  await assertAnimation('#project-generate .generation-wave i');

  // A status filter can hide every pending line without ending the background task.
  await choose('#project-filter-status', 'new');
  assert.equal(await page.locator('.project-line-row').count(), 0);
  assert.match(await generate.textContent(), /生成中/);
  assert.equal(await generate.getAttribute('aria-busy'), 'true');
  await page.locator('#project-filter-reset').click();

  // A different chapter remains available while the current one generates.
  await page.locator('#project-chapters>button').last().click();
  assert.equal(await generate.getAttribute('aria-busy'), 'false');
  assert.match(await generate.textContent(), /生成 1 句/);
  assert.equal(await generate.isDisabled(), false);
  await page.locator('#project-chapters>button').nth(1).click();
  assert.match(await generate.textContent(), /生成中 · 1\/2/);

  queue.acceptProgress({ stage: 'clip', item: items[1] });
  await page.waitForFunction(() => document.querySelector('#project-generate').textContent.includes('正在收尾'));
  assert.equal(await generate.getAttribute('aria-busy'), 'true');
  execution.resolve({ items });
  await page.waitForFunction(() => document.querySelector('#project-generate').textContent.includes('已全部生成'));
  assert.equal(queue.snapshot().jobs.find(job => job.id === active.id).status, 'complete');
  assert.equal(await generate.getAttribute('aria-busy'), 'false');
  assert.equal(await generate.locator('.generation-wave').count(), 0);
  await choose('#project-filter-status', 'new');
  assert.equal((await generate.textContent()).trim(), '暂无待生成', 'an empty filter does not imply completion');
  await page.locator('#project-filter-reset').click();

  // Queueing and failure must also keep the label honest and restore retry.
  await page.locator('#project-chapters>button').last().click();
  const blocker = queue.submit({ mode: 'preset', speaker: 'Vivian', engine: 'standard', text: '占用引擎，检查排队。' }, 'project-state-blocker');
  await page.waitForFunction(() => document.querySelector('#generation-queue-count').textContent.includes('生成中'));
  const blockerExecution = executions.at(-1);
  await generate.click();
  await page.waitForFunction(() => document.querySelector('#project-generate').dataset.generationState === 'queued');
  assert.match(await generate.textContent(), /排队中/);
  assert.equal(await generate.getAttribute('aria-busy'), 'true');
  assert.equal(await generate.locator('.ui-icon').evaluate(node => node.getAnimations().some(animation => animation.animationName === 'project-generation-spin')), true);
  blockerExecution.resolve({ items: [{ ...clip, id: blocker.id + '-clip' }] });
  await page.waitForFunction(() => document.querySelector('#project-generate').dataset.generationState === 'running');
  executions.at(-1).reject(new Error('项目生成失败测试'));
  await page.waitForFunction(() => !document.querySelector('#project-generate').disabled);
  assert.match(await generate.textContent(), /生成 1 句/);
  assert.equal(await generate.getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('.project-line-generate[aria-busy="true"]').count(), 0);
}
