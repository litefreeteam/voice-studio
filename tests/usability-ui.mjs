import assert from 'node:assert/strict';

export async function testUsability(page) {
  const choose = (selector, value) => page.locator(selector).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const docx = { extension: '.docx', parts: { 'word/document.xml': '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>教学目标：</w:t></w:r><w:r><w:t>面积 &amp; 周长</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>知识点：长乘宽。</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' } };
  const pptx = { extension: '.pptx', parts: {
    'ppt/presentation.xml': '<p:presentation xmlns:p="ppt" xmlns:r="relationships"><p:sldIdLst><p:sldId id="2" r:id="second"/><p:sldId id="1" r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<p:sld xmlns:p="ppt" xmlns:a="draw"><a:p><a:r><a:t>页面回退文字</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld xmlns:p="ppt" xmlns:a="draw"><a:p><a:r><a:t>不用这段页面文字</a:t></a:r></a:p></p:sld>',
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="notes" Type="ooxml/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide2.xml': '<p:notes xmlns:p="ppt" xmlns:a="draw"><p:sp><p:ph type="body"/><a:p><a:r><a:t>优先读取的备注</a:t></a:r></a:p></p:sp><p:sp><p:ph type="sldNum"/><a:p><a:r><a:t>99</a:t></a:r></a:p></p:sp></p:notes>'
  } };
  const documents = await page.evaluate(({ docx, pptx }) => [OfficeDocuments.parse(docx), OfficeDocuments.parse(pptx)], { docx, pptx });
  assert.equal(documents[0].text, '教学目标：面积 & 周长\n知识点：长乘宽。');
  assert.equal(documents[1].text, '# 第 1 页\n优先读取的备注\n\n# 第 2 页\n页面回退文字');
  assert.match(documents[1].note, /1 页使用备注，1 页无备注/);
  assert.match(await page.evaluate(() => { try { OfficeDocuments.parse({ extension: '.docx', parts: { 'word/document.xml': '<broken>' } }); } catch (error) { return error.message; } }), /损坏/);
  const nestedDocument = await page.evaluate(() => OfficeDocuments.parse({ extension: '.docx', parts: {
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文开头</w:t><w:drawing><w:txbxContent><w:p><w:r><w:t>文本框第一段</w:t></w:r></w:p><w:p><w:r><w:t>文本框第二段</w:t></w:r></w:p></w:txbxContent></w:drawing><w:t>正文结尾</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t><w:tab/><w:t>下一列</w:t><w:br/><w:t>换行</w:t></w:r><w:del><w:r><w:delText>已删除内容</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  } }));
  assert.equal(nestedDocument.text, '正文开头正文结尾\n文本框第一段\n文本框第二段\n表格内容\t下一列\n换行');
  const nestedLines = await page.evaluate(text => ScriptProjects.parse(text, 'textbox.docx', catalog.emotions, parseScript, { scriptMode: 'narration' }).chapters.flatMap(chapter => chapter.lines.map(line => line.text)), nestedDocument.text);
  for (const text of ['文本框第一段', '文本框第二段']) assert.equal(nestedLines.filter(line => line.includes(text)).length, 1, 'each text-box paragraph becomes spoken text only once');

  await page.locator('[data-view="home"]').click();
  await page.locator('#home-search').fill('门店促销');
  assert.equal(await page.locator('[data-scenario="ecommerce"]').count(), 1);
  await page.locator('[data-start-scenario="ecommerce"]').click();
  await page.locator('#project-import').click();
  assert.equal(await page.locator('#project-import-script-mode').inputValue(), 'narration');
  await page.locator('#project-import-text').fill(documents[0].text);
  await page.locator('#project-import-preview').click();
  assert.equal(await page.locator('#project-import-mappings [data-role-name]').count(), 1);
  assert.match(await page.locator('#project-import-sample').textContent(), /教学目标：面积 & 周长/);
  await page.locator('#project-import-edit').click();
  await page.locator('#project-import-text').fill(nestedDocument.text);
  await page.locator('#project-import-preview').click();
  const nestedPreview = await page.locator('#project-import-sample').textContent();
  for (const text of ['文本框第一段', '文本框第二段']) assert.equal(nestedPreview.split(text).length - 1, 1, 'text-box content appears only once in the import preview');
  await page.locator('#project-import-edit').click();
  await choose('#project-import-script-mode', 'dialogue');
  const lines = Array.from({ length: 25 }, (_, i) => '旁白：第' + (i + 1) + '条内容。'); lines[22] = '张明放下伞：“路上堵车。”';
  await page.locator('#project-import-text').fill(lines.join('\n'));
  await page.locator('#project-import-preview').click();
  assert.equal(await page.locator('.import-preview-row').count(), 20);
  await page.locator('#project-import-next').click();
  assert.match(await page.locator('#project-import-page').textContent(), /第 2 \/ 2 页/);
  assert.match(await page.locator('#project-import-sample').textContent(), /第 23 条/);
  await choose('#project-import-filter', 'review');
  assert.equal(await page.locator('.import-preview-row').count(), 1);
  await choose('.import-preview-row select', '旁白');
  assert.match(await page.locator('#project-import-summary').textContent(), /0 条待分配/);
  await page.locator('#project-import-apply').click();
  await page.locator('#project-options-open').click(); await page.locator('[data-project-target="15"]').click();
  assert.match(await page.locator('#project-duration-estimate').textContent(), /目标 15 秒/);
  await page.locator('#project-target-seconds').blur();
  await page.locator('#project-options-done').click();

  // Preserve an unsaved role form while fetching packages; return to this project even after navigation.
  await page.locator('#project-fix-roles').click();
  await page.locator('#project-role-name').fill('保留我的角色名');
  await page.evaluate(() => { state.packages = [{ id: 'standard', ready: true }]; });
  await page.locator('#project-role-prepare-voice').click();
  assert.equal(await page.locator('#package-task').isVisible(), true);
  assert.equal(await page.locator('.package-needed').count(), 2);
  assert.match(await page.locator('#package-task-detail').textContent(), /人物与童声、我的专属声音/);
  await page.locator('#package-task-return').click();
  await page.locator('#project-role-dialog').waitFor();
  assert.equal(await page.locator('#project-role-name').inputValue(), '保留我的角色名');
  await page.locator('#project-role-installed').click();
  assert.equal(await page.locator('#project-role-prepare-voice').isVisible(), false);
  await page.locator('#project-role-form .primary').click();
  await page.locator('#project-role-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');

  // A new role opened from a line must retain that line through package preparation.
  const firstLine = page.locator('.project-line-row').first(), targetLineId = await firstLine.getAttribute('data-line-id');
  const projectId = await page.evaluate(lineId => [...window.testProjects.values()].find(project => project.chapters.some(chapter => chapter.lines.some(line => line.id === lineId))).id, targetLineId);
  const beforeAssignment = await page.evaluate(id => studio.invoke('project-load', { id }), projectId);
  await choose('.project-line-row:first-child select[aria-label$="条台词的角色"]', '__new');
  await page.locator('#project-role-name').fill('下载后分配的新角色');
  await choose('#project-role-voice', 'design:girl-clear');
  await page.locator('.project-role-advanced summary').click();
  await page.locator('#project-role-description').fill('清晰活泼、语速从容的少女声音');
  await page.locator('#project-role-aliases').fill('新角色、小雨');
  // Returning before downloads finish, then re-entering preparation, must also preserve the target.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('#project-role-prepare-voice').click();
    await page.locator('#package-task-return').waitFor();
    await page.locator('#package-task-return').click();
    await page.locator('#project-role-dialog').waitFor();
    assert.equal(await page.locator('#project-role-name').inputValue(), '下载后分配的新角色');
    assert.equal(await page.locator('#project-role-description').inputValue(), '清晰活泼、语速从容的少女声音');
    assert.equal(await page.locator('#project-role-aliases').inputValue(), '新角色、小雨');
  }
  await page.evaluate(() => { state.packages = ['standard', 'character', 'reference'].map(id => ({ id, ready: true })); });
  await page.locator('#project-role-prepare-voice').click();
  await page.waitForFunction(() => !document.querySelector('#project-role-prepare-voice').disabled);
  await page.locator('#project-role-form .primary').click();
  await page.locator('#project-role-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  const afterAssignment = await page.evaluate(id => studio.invoke('project-load', { id }), projectId);
  const newRole = afterAssignment.roles.find(role => role.name === '下载后分配的新角色');
  assert.ok(newRole?.options.voiceAnchorId, 'the new role saves its prepared voice');
  for (const chapter of beforeAssignment.chapters) for (const line of chapter.lines) {
    const savedLine = afterAssignment.chapters.flatMap(chapter => chapter.lines).find(saved => saved.id === line.id);
    assert.equal(savedLine.roleId, line.id === targetLineId ? newRole.id : line.roleId, 'only the originating line receives the new role');
  }
  await page.locator('[data-view="home"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.home-recent-item').length > 0);
  assert.match(await page.locator('.home-recent-item').first().textContent(), /带货口播/);
  await page.locator('.home-recent-item').first().click();
  assert.equal(await page.locator('#project-target-seconds').inputValue(), '15');
  const targetChapter = afterAssignment.chapters.find(chapter => chapter.lines.some(line => line.id === targetLineId));
  await page.locator(`[data-chapter-id="${targetChapter.id}"]`).click();
  assert.equal(await page.locator(`[data-line-id="${targetLineId}"] select[aria-label$="条台词的角色"]`).inputValue(), newRole.id, 'the original line assignment survives reopening the project, including when preparation preserved a later chapter');
  await page.locator('#project-delivery').click();
  assert.match(await page.locator('.delivery-package').textContent(), /WAV \+ MP3 · 按段 SRT/);
  await page.locator('#project-delivery-cancel').click();

  await page.evaluate(() => { roles.push({ id: 'audit-voice', name: '旧名字', voiceKey: 'preset:Serena', options: { mode: 'preset', voiceName: '温宁', emotion: 'natural' } }); persistRoles(); });
  await page.locator('[data-view="roles"]').click();
  await page.getByRole('button', { name: '编辑声音资料：旧名字', exact: true }).click();
  await page.locator('#voice-details-name').fill('房产介绍女声'); await page.locator('#voice-details-note').fill('温暖自然，用于楼盘介绍');
  await page.locator('#voice-details-form [type="submit"]').click();
  assert.match(await page.locator('[data-role-id="audit-voice"]').textContent(), /房产介绍女声/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shengyue-roles-1')).find(role => role.id === 'audit-voice'));
  assert.equal(saved.note, '温暖自然，用于楼盘介绍');
  await page.evaluate(() => {
    const original = window.studio.invoke, work = VoiceLab.create('variants'); work.name = '最近的实验室作品'; work.updatedAt = Date.now() + 1000;
    window.studio.invoke = async (action, data) => {
      if (action === 'lab-list') return [structuredClone(work)];
      if (action === 'lab-load' && data.id === work.id) return structuredClone(work);
      if (action === 'lab-save') { Object.assign(work, data); return { saved: true }; }
      return original(action, data);
    };
  });
  await page.locator('[data-view="home"]').click();
  await page.waitForFunction(() => document.querySelector('.home-recent-item')?.textContent.includes('最近的实验室作品'));
  await page.locator('.home-recent-item').first().click();
  assert.equal(await page.locator('#lab-name').inputValue(), '最近的实验室作品');
  await page.locator('[data-view="home"]').click();
  console.log('Passed usability additions: Office XML and slide order, nested Word text boxes without duplicate narration, industry search, narration preservation, 25-line pagination and correction, package return with unsaved role and persistent line assignment, installed voice fallback, saved target duration, SRT delivery entry, voice metadata, project and laboratory resume.');
}
