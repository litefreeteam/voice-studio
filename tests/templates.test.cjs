const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../shared/catalog.json');
const templates = require('../ui/templates.js');
const { prepareGeneration } = require('../desktop/jobs.cjs');
const allVoices = [...catalog.voices.map(voice => ({ ...voice, key: `preset:${voice.id}` })), ...catalog.characters.map(voice => ({ ...voice, key: `design:${voice.id}` }))];

test('42 distinct voice definitions and 20 usable templates reference supported catalog settings', () => {
  assert.equal(allVoices.length, 42);
  assert.equal(catalog.voices.length, 9);
  assert.equal(catalog.templates.length, 20);
  assert.equal(new Set(allVoices.map(voice => voice.key)).size, allVoices.length);
  assert.equal(new Set(catalog.characters.map(voice => voice.prompt)).size, catalog.characters.length);
  assert.equal(new Set(catalog.templates.map(template => template.id)).size, 20);
  for (const template of catalog.templates) {
    assert.ok(catalog.templateCategories.some(category => category.id === template.category));
    assert.ok(allVoices.some(voice => voice.key === template.voiceKey));
    assert.ok(catalog.scenes.some(scene => scene.id === template.scene));
    assert.ok(catalog.emotions.some(emotion => emotion.id === template.emotion));
    assert.ok(catalog.languages.some(language => language.id === template.language));
    const project = templates.project(template, catalog);
    const prepared = prepareGeneration(project.script ? { ...project.options, rows: project.rows } : { ...project.options, text: project.text, batch: project.batch });
    assert.ok(prepared.rows.length > 0 && prepared.rows.length <= 100);
    for (const row of project.rows) {
      assert.ok(allVoices.some(voice => voice.key === row.voiceKey));
      assert.ok(catalog.emotions.some(emotion => emotion.id === row.emotion));
      assert.match(row.filename, /^[\w-]{1,80}$/);
    }
  }
});

test('templates preserve user-entered project names, provide complete expression defaults and do not mutate source rows', () => {
  const course = catalog.templates.find(template => template.id === 'course-batch');
  const project = templates.project(course, catalog, '我的课程');
  assert.equal(project.options.project, '我的课程');
  assert.equal(project.voiceKey, 'design:clear-female');
  assert.equal(project.batch, true);
  assert.equal(project.script, false);
  assert.equal(project.options.language, 'Chinese');
  assert.equal(project.options.engine, 'standard');
  assert.equal(project.options.referenceText, '');
  assert.equal(project.options.voiceDescription, catalog.characters.find(voice => voice.id === 'clear-female').prompt);
  assert.equal(templates.project(course, catalog).options.project, '');
  const dialogue = catalog.templates.find(template => template.id === 'game-dialogue');
  const script = templates.project(dialogue, catalog);
  script.rows[0].text = '用户修改';
  assert.notEqual(dialogue.rows[0].text, script.rows[0].text);
  assert.equal(script.script, true);
});

test('template search combines keywords, category and actual voice names with normalized case', () => {
  assert.equal(templates.filter(catalog.templates, catalog).length, 20);
  assert.equal(templates.filter(catalog.templates, catalog, 'course').length, 6);
  assert.deepEqual(templates.filter(catalog.templates, catalog, 'all', '课程 沐言').map(template => template.id), ['course-batch']);
  assert.deepEqual(templates.filter(catalog.templates, catalog, 'all', '课程 知微').map(template => template.id), ['exam-review']);
  assert.equal(templates.filter(catalog.templates, catalog, 'all', 'ＥＮＧＬＩＳＨ').length, 1);
  assert.equal(templates.filter(catalog.templates, catalog, 'story', 'English').length, 0);
  assert.equal(templates.filter(catalog.templates, catalog, 'all', '不存在的模板').length, 0);
});
