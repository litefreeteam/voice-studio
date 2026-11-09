/* Project editing is independent of the quick editor and the background queue. */
window.createProjectWorkspace = function (hooks) {
  const M = window.ScriptProjects, $ = selector => document.querySelector(selector), PAGE_SIZE = 30;
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (label, cls, action) => { const n = node('button', cls, label); n.type = 'button'; n.onclick = guard(action); return n; };
  const option = (select, value, text) => { const n = node('option', '', text); n.value = value; select.append(n); };
  const guard = fn => async (...args) => { try { return await fn(...args); } catch (error) { hooks.toast(cleanError(error), true); } };
  const cleanError = error => String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
  const labels = { unassigned: '待分配', new: '未生成', changed: '需要更新', pending: '处理中', complete: '已完成' };
  const libraryNameSort = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  let project = null, summaries = [], chapterId = '', page = 1, selected = new Set(), undo = [];
  let libraryPage = 1, libraryLayout = 'grid';
  let timer, summaryTimer, revision = 0, dirty = false, saving = 0, derived = null, loading = false;
  let editingRoleId = null, editingVoiceRevision = '', roleTarget = null, parsed = null, importFilename = '', confirmAction = null;
  let draftRoleId = '', preparedRoleVoice = null, preparingRoleVoice = false;
  let importPage = 1, roleEngineOverride = '';
  let audio = null, audioUrl = null, playbackToken = 0, listening = false, submitting = false, creating = false;
  let submittingLineIds = new Set();
  let playbackKey = '', activeLineId = '';
  let audioFeedback = null, playbackPhase = 'idle';
  let deliveryProjectId = '', deliveryReturnFocus = null, deliveryReviewKey = '', deliveryCloseAfterCancel = false;
  const delivery = M.createDeliveryController({ api: hooks.api, onChange: () => renderDelivery() });
  // Keep production and bulk actions next to the filters, including for long chapters.
  $('.project-script-column').prepend($('.project-production'));
  $('.project-selection').after($('#project-bulk'));
  option($('#project-filter-status'), 'review', '建议核对音频');
  const mixer = window.createProjectMixer({
    api: hooks.api, media: hooks.media, refresh: hooks.refresh, toast: hooks.toast,
    project: () => project, entries: () => scoped(), settings: () => deliverySettings(),
    scopeLabel: () => deliveryScopeLabel($('#project-generation-scope').value),
    stopOtherAudio: () => { stopAudio(); hooks.stopOtherAudio(); },
    apply: async (mix, owner) => {
      if (project?.id !== owner) throw new Error('项目已切换，请重新打开混音设置。');
      const previous = project.mix, previousUndo = undo.slice(), next = structuredClone(mix);
      mutate(() => project.mix = next); const appliedRevision = revision;
      try { await save(); }
      catch (error) {
        if (project?.id === owner && project.mix === next) {
          if (previous === undefined) delete project.mix; else project.mix = previous;
          if (revision === appliedRevision) undo = previousUndo;
          markChanged(); render();
        }
        throw error;
      }
    }
  });
  $('#project-mix-slot').append(mixer.entry);
  function renderMix() { mixer.refresh(); }

  function markChanged() {
    revision++; dirty = true; derived = null;
    $('#project-save-state').textContent = '正在保存…'; $('#project-save-retry').hidden = true;
    clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 300);
    clearTimeout(summaryTimer); summaryTimer = setTimeout(() => { renderMeta(); refreshMedia(); }, 120);
    $('#project-undo').disabled = !undo.length;
  }
  async function save() {
    clearTimeout(timer);
    if (!project || !dirty) return;
    const snapshot = structuredClone(project), current = revision; saving++;
    try {
      const result = await hooks.api('project-save', snapshot);
      if (!result?.saved) throw new Error('项目保存失败');
      if (project?.id === snapshot.id && current === revision) {
        dirty = false; project.updatedAt = result.updatedAt;
        $('#project-save-state').textContent = '已自动保存'; $('#project-save-retry').hidden = true;
      }
    } catch (error) {
      if (project?.id === snapshot.id) { $('#project-save-state').textContent = '保存失败，内容仍保留在当前窗口'; $('#project-save-retry').hidden = false; }
      throw error;
    } finally { saving--; }
  }
  function flush() {
    clearTimeout(timer);
    if (!project || !dirty && !saving) return;
    try {
      const result = window.studio.saveProjectSync(project);
      if (result?.saved) dirty = false;
    } catch {}
  }
  function pushUndo() { undo.push(structuredClone(project)); if (undo.length > 20) undo.shift(); }
  function mutate(action) {
    const previous = structuredClone(project);
    try { action(project); M.validate(project); }
    catch (error) {
      project = previous; derived = null;
      if (chapterId && !project.chapters.some(chapter => chapter.id === chapterId)) chapterId = project.chapters[0].id;
      render(); throw error;
    }
    undo.push(previous); if (undo.length > 20) undo.shift(); markChanged(); render();
  }
  function editInput(input, setter) {
    let started = false;
    input.addEventListener('focus', () => { started = false; });
    input.addEventListener('input', () => {
      if (!started) { pushUndo(); started = true; }
      setter(input.value); markChanged();
    });
  }
  function contexts() {
    if (derived) return derived;
    const media = hooks.media(), index = M.audioIndex(media.history, project.id), pending = new Set(), generationJobs = new Map();
    for (const job of media.jobs) if (job.projectId === project.id && ['queued', 'scheduled', 'running', 'paused'].includes(job.status)) {
      for (const row of job.rows.slice(job.managed ? job.cursor : job.completed)) {
        const key = row.lineId + '\n' + row.lineVersion;
        pending.add(key);
        if (generationJobs.get(key)?.status !== 'running') generationJobs.set(key, job);
      }
    }
    const voiceCache = new Map();
    const resolve = key => { if (!voiceCache.has(key)) voiceCache.set(key, hooks.resolveVoice(key)); return voiceCache.get(key); };
    derived = M.entries(project).map(entry => {
      const options = M.optionsFor(project, entry, resolve);
      const state = M.lineState(entry, options, index, pending);
      return { ...entry, options, ...state, generationJob: state.status === 'pending' ? generationJobs.get(entry.line.id + '\n' + M.fingerprint(options)) : null };
    });
    return derived;
  }
  function filtered(ignoreStatus = false) {
    const query = $('#project-line-search').value.trim().toLocaleLowerCase(), role = $('#project-filter-role').value, status = $('#project-filter-status').value;
    return contexts().filter(entry => (!chapterId || entry.chapter.id === chapterId) && (!query || entry.line.text.toLocaleLowerCase().includes(query)) &&
      (!role || (role === '__unassigned' ? !entry.line.roleId : entry.line.roleId === role)) && (ignoreStatus || !status || (status === 'todo' ? !['complete', 'pending'].includes(entry.status) : status === 'review' ? entry.clips.some(clip => (clip.editedQuality || clip.quality)?.review) : entry.status === status)));
  }
  function scoped(scope = $('#project-generation-scope').value, ignoreStatus = false) {
    if (scope === 'selected') return contexts().filter(entry => selected.has(entry.line.id));
    if (scope === 'filtered') return filtered(ignoreStatus);
    return contexts().filter(entry => scope === 'all' || !chapterId || entry.chapter.id === chapterId);
  }
  function resetFilters() {
    $('#project-line-search').value = ''; $('#project-filter-role').value = ''; $('#project-filter-status').value = '';
    page = 1; selected.clear();
  }
  function confirm(title, description, action) {
    confirmAction = action; $('#project-confirm-heading').textContent = title; $('#project-confirm-description').textContent = description;
    $('#project-confirm-dialog').showModal();
  }
  async function library() {
    if (loading) return;
    loading = true;
    try {
      await save(); stopAudio(); dismissDeliveryForNavigation();
      summaries = await hooks.api('projects-list');
      $('#project-library').hidden = false; $('#project-detail').hidden = true;
      renderLibrary();
    } finally { loading = false; }
  }
  function libraryIcon(name, projectIcon = false) {
    const icon = node('span', 'ui-icon ' + (projectIcon ? 'project-icon-' : 'icon-') + name);
    icon.setAttribute('aria-hidden', 'true'); return icon;
  }
  async function copyProject(item) {
    const source = await hooks.api('project-load', { id: item.id }), replacement = M.duplicate(source);
    await hooks.api('project-save', replacement); libraryPage = 1; await open(replacement.id);
  }
  function deleteProject(item) {
    confirm('删除配音项目及配音音频？', '将删除「' + item.name + '」的角色、章节、台词，以及该项目生成的全部配音音频和版本，删除后无法恢复。请先导出需要保留的音频。', async () => {
      await hooks.api('project-delete', { id: item.id });
      if (project?.id === item.id) { clearTimeout(timer); project = null; dirty = false; }
      await hooks.refresh();
      await library();
    });
  }
  function changeLibraryPage(destination) {
    libraryPage = destination; renderLibrary();
    $('.project-library-bar').scrollIntoView({ block: 'start', behavior: 'instant' });
    $('#project-library-pages [aria-current="page"]')?.focus({ preventScroll: true });
  }
  function renderLibrary() {
    const query = $('#project-search').value.trim().toLocaleLowerCase(), sort = $('#project-library-sort').value;
    const found = summaries.filter(item => item.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
      if (sort === 'name') return libraryNameSort.compare(a.name, b.name) || a.id.localeCompare(b.id);
      const order = Number(a.updatedAt) - Number(b.updatedAt);
      return (sort === 'oldest' ? order : -order) || libraryNameSort.compare(a.name, b.name) || a.id.localeCompare(b.id);
    });
    const result = window.WorkHistory.paginate(found, libraryPage, $('#project-library-page-size').value);
    libraryPage = result.page;
    const list = $('#project-list'); list.replaceChildren(); list.classList.toggle('is-list', libraryLayout === 'list');
    $('#project-library-count').textContent = query ? `找到 ${found.length} 个项目` : `${summaries.length} 个配音项目`;
    for (const item of result.items) {
      const card = node('article', 'card project-card'); card.dataset.projectId = item.id;
      card.dataset.color = String([...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5);
      const heading = node('div', 'project-card-heading'), title = button(item.name, 'project-card-title', () => open(item.id));
      title.title = item.name;
      const name = node('h2', 'project-card-name'); name.append(title);
      const dot = node('span', 'project-card-dot'); dot.setAttribute('aria-hidden', 'true'); heading.append(dot, name);
      const meta = node('ul', 'project-card-meta');
      for (const [icon, value, label, custom] of [['book-open', item.chapterCount, '个章节'], ['users', item.roleCount, '个角色', true], ['audio-lines', item.lineCount, '条台词']]) {
        const stat = node('li'); stat.append(libraryIcon(icon, custom), node('b', '', value), document.createTextNode(label)); meta.append(stat);
      }
      const edited = new Date(item.updatedAt), date = node('div', 'project-card-date');
      const time = node('time', '', edited.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
      time.dateTime = edited.toISOString(); date.append(libraryIcon('clock', true), document.createTextNode('编辑于 '), time);
      const actions = node('div', 'project-card-actions');
      const copy = button('复制项目', 'text-button', () => copyProject(item)); copy.prepend(libraryIcon('copy', true));
      const remove = button('删除', 'text-button project-card-delete', () => deleteProject(item)); remove.prepend(libraryIcon('trash-2'));
      const resume = button('继续创作', 'button project-card-continue', () => open(item.id)); resume.append(libraryIcon('arrow-right'));
      actions.append(copy, remove, resume); card.append(heading, meta, date, actions); list.append(card);
    }
    if (!found.length) {
      const empty = node('div', 'card project-library-empty');
      empty.append(libraryIcon(query ? 'search' : 'folder'), node('h2', '', query ? '没有找到这个项目' : '从一个故事，开始多角色创作'), node('p', '', query ? '换个关键词试试，或清空搜索查看全部项目。' : '新建项目，导入文案，为每个角色选一个声音。'));
      empty.append(query ? button('清空搜索', 'button', () => { $('#project-search').value = ''; libraryPage = 1; renderLibrary(); $('#project-search').focus(); }) : button('新建配音项目', 'primary', newDialog)); list.append(empty);
    }
    $('#project-library-pagination').hidden = !found.length;
    $('#project-library-range').textContent = `共 ${result.total} 个 · 显示 ${result.start}–${result.end} 个`;
    const navigation = $('#project-library-pages'); navigation.replaceChildren();
    const addPage = (label, destination, disabled = false, current = false) => {
      const control = button(label, '', () => changeLibraryPage(destination)); control.disabled = disabled;
      if (current) control.setAttribute('aria-current', 'page');
      control.setAttribute('aria-label', /^\d+$/.test(label) ? `第 ${label} 页` : label); navigation.append(control);
    };
    addPage('上一页', result.page - 1, result.page === 1);
    result.numbers.forEach((number, index) => {
      if (index && number > result.numbers[index - 1] + 1) { const dots = node('span', '', '…'); dots.setAttribute('aria-hidden', 'true'); navigation.append(dots); }
      addPage(String(number), number, false, number === result.page);
    });
    addPage('下一页', result.page + 1, result.page === result.pages);
    window.CustomSelects?.sync();
  }
  async function open(id, value) {
    await save(); stopAudio(); dismissDeliveryForNavigation();
    project = value || await hooks.api('project-load', { id });
    const deliveryOptions = { ...M.DELIVERY_DEFAULTS, ...project.deliverySettings };
    for (const [id, key] of [['project-delivery-normalize', 'normalize'], ['project-delivery-trim', 'trimSilence'], ['project-delivery-segments', 'includeSegments']]) $('#' + id).checked = deliveryOptions[key];
    $('#project-delivery-pause').value = deliveryOptions.pauseMs;
    chapterId = project.chapters[0].id; page = 1; selected.clear(); undo = []; derived = null; dirty = false;
    resetFilters(); $('#project-generation-scope').value = 'filtered';
    $('#project-library').hidden = true; $('#project-detail').hidden = false;
    $('#project-save-state').textContent = '已自动保存'; $('#project-save-retry').hidden = true;
    hooks.navigate(); render();
    if (project.retiredMarkupNotice) { delete project.retiredMarkupNotice; hooks.toast('段内拼接功能已撤回；旧标记已转回普通文案，完整原稿已备份。'); }
  }
  function resourceLocation() {
    flush();
    return project ? { id: project.id, chapterId, page, selected: [...selected],
      filters: Object.fromEntries(['project-line-search', 'project-filter-role', 'project-filter-status', 'project-generation-scope'].map(id => [id, $('#' + id).value])) } : null;
  }
  async function restoreResourceLocation(location) {
    if (!project || project.id !== location.id) await open(location.id);
    chapterId = project.chapters.some(chapter => chapter.id === location.chapterId) ? location.chapterId : '';
    page = Number.isInteger(location.page) && location.page > 0 ? location.page : 1;
    selected = new Set((location.selected || []).filter(id => contexts().some(entry => entry.line.id === id)));
    for (const id of ['project-line-search', 'project-filter-role', 'project-filter-status', 'project-generation-scope']) {
      if (typeof location.filters?.[id] === 'string') $('#' + id).value = location.filters[id];
    }
    hooks.navigate(); render();
    if (location.role) {
      const role = location.role;
      roleDialog(role.originalRoleId, role.originalRoleTarget); draftRoleId = role.roleId; roleEngineOverride = role.engine;
      for (const [id, value, checked] of role.form) {
        const control = document.getElementById(id);
        if (control && $('#project-role-form').contains(control)) { control.value = value; control.checked = checked; }
      }
      rolePerformance();
    }
  }
  function newDialog() {
    $('#project-new-name').value = ''; $('#project-new-dialog').showModal(); $('#project-new-name').focus();
  }
  function renderMeta() {
    if (!project) return;
    const all = contexts();
    $('#project-meta').textContent = project.chapters.length + ' 章 · ' + project.roles.length + ' 个角色 · ' + all.length + ' 条台词';
    $('#project-chapter-count').textContent = project.chapters.length; $('#project-cast-count').textContent = project.roles.length;
  }
  function needsSetup(entry) {
    return !entry.options || entry.options.mode === 'design' && (!entry.options.voiceDescription?.trim() || entry.options.lockVoice && !entry.options.voiceAnchorId);
  }
  function jumpTo(selector) {
    const target = $(selector); target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  }
  function fixRoles(entries = contexts()) {
    const unresolved = entries.filter(entry => entry.line.text.trim() && needsSetup(entry));
    if (unresolved.some(entry => !project.roles.some(role => role.id === entry.line.roleId))) {
      chapterId = ''; resetFilters(); $('#project-filter-status').value = 'unassigned'; $('#project-generation-scope').value = 'filtered';
      render(); jumpTo('#project-filter-status-trigger');
      hooks.toast('已显示待分配台词。逐句选角色，或选择全部后批量分配。');
      return;
    }
    if (unresolved.length) return roleDialog(unresolved[0].line.roleId);
    if (project.roles.length === 1) return roleDialog(project.roles[0].id);
    jumpTo('.project-cast');
  }
  function visitStep(step) {
    if (step === 'import') return importDialog();
    if (step === 'roles') return fixRoles();
    if (step === 'generate' || step === 'export') {
      const relevant = entry => entry.line.text.trim() && (step === 'generate' ? entry.status !== 'complete' : entry.clips.length);
      if (!scoped().some(relevant) && contexts().some(relevant)) {
        chapterId = ''; resetFilters(); $('#project-generation-scope').value = 'all'; render();
      }
    }
    if (step === 'generate') return jumpTo('.project-production');
    if (contexts().some(entry => entry.line.text.trim())) return openDelivery();
    $('#project-add-line').click();
  }
  function renderWorkflow() {
    const all = contexts().filter(entry => entry.line.text.trim()), unresolved = all.filter(needsSetup);
    const complete = all.filter(entry => entry.status === 'complete').length;
    const pending = all.filter(entry => entry.status === 'pending').length;
    const managedJobs = hooks.media().jobs.filter(job => job.projectId === project.id && job.managed && ['queued', 'scheduled', 'running', 'paused'].includes(job.status));
    const waiting = managedJobs.length && managedJobs.every(job => ['scheduled', 'paused'].includes(job.status));
    const hasAudio = all.some(entry => entry.clips.length);
    // Show the controls before focusing a newly added, still-empty line. Waiting
    // for its first word inserts this entire panel above the active textarea.
    $('.project-production').hidden = !contexts().length;
    const stage = !all.length ? 0 : unresolved.length ? 1 : complete === all.length ? 3 : 2;
    document.querySelectorAll('[data-project-step]').forEach((item, index) => {
      item.classList.toggle('is-done', index < stage);
      if (index === stage) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.querySelector('.project-step-state').textContent = index === stage ? '当前' : '';
    });
    $('#project-import-step-summary').textContent = all.length ? all.length + ' 句台词' : '添加文案';
    $('#project-role-summary').textContent = unresolved.length ? unresolved.length + ' 句待设置' : project.roles.length + ' 个角色';
    $('#project-generate-step-summary').textContent = pending ? pending + (waiting ? ' 句已托管' : ' 句处理中') : all.length ? complete + ' / ' + all.length : '准备生成';
    $('#project-export-step-summary').textContent = hasAudio ? '音频 · 字幕' : '试听与导出';
    // Guidance makes room for the script as soon as a row is added, including
    // a blank row, so entering its first word never shifts the active editor.
    $('.project-next').hidden = contexts().length > 0;
    const action = $('#project-next-action'), secondary = $('#project-next-secondary');
    action.onclick = importDialog; secondary.onclick = () => $('#project-add-line').click();
  }
  function fillRoles(select, placeholder, includePending = false) {
    const value = select.value; select.replaceChildren(); option(select, '', placeholder);
    if (includePending) option(select, '__unassigned', '未分配角色');
    select.dataset.selectKind = 'project-role';
    for (const role of project.roles) { option(select, role.id, role.name); select.lastElementChild.dataset.voiceKey = role.voiceKey; }
    select.value = [...select.options].some(item => item.value === value) ? value : '';
  }
  function renderChapters() {
    const list = $('#project-chapters'); list.replaceChildren();
    const choose = value => { chapterId = value; page = 1; selected.clear(); $('#project-generation-scope').value = 'filtered'; render(); };
    const all = button('全部章节', !chapterId ? 'selected' : '', () => choose('')); all.prepend(libraryIcon('list')); all.setAttribute('aria-pressed', String(!chapterId)); list.append(all);
    for (const chapter of project.chapters) {
      const item = button('', chapter.id === chapterId ? 'selected' : '', () => choose(chapter.id)); item.dataset.chapterId = chapter.id;
      item.append(libraryIcon('book-open'), node('span', '', chapter.name), node('small', '', chapter.lines.length)); item.setAttribute('aria-pressed', String(chapter.id === chapterId)); list.append(item);
    }
    const chapter = project.chapters.find(item => item.id === chapterId);
    $('#project-chapter-title').value = chapter?.name || '全部章节'; $('#project-chapter-title').disabled = !chapter;
    $('#project-remove-chapter').hidden = !chapter;
    const chapterIndex = project.chapters.findIndex(item => item.id === chapterId);
    $('#project-chapter-up').disabled = chapterIndex <= 0; $('#project-chapter-down').disabled = chapterIndex < 0 || chapterIndex >= project.chapters.length - 1;
    $('#project-generation-scope option[value="chapter"]').textContent = chapter ? '当前章节' : '全部章节';
  }
  function renderCast() {
    const list = $('#project-cast'); list.replaceChildren();
    const counts = new Map(); for (const { line } of M.entries(project)) counts.set(line.roleId, (counts.get(line.roleId) || 0) + 1);
    for (const role of project.roles) {
      const item = node('article', 'project-cast-item'); item.dataset.roleId = role.id;
      item.dataset.color = String([...role.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5);
      item.classList.toggle('is-active', $('#project-filter-role').value === role.id);
      const profile = node('div', 'project-cast-profile'), info = node('div', 'project-cast-info');
      const avatar = hooks.avatar(role.voiceKey); avatar.classList.add('project-cast-avatar');
      if (!avatar.querySelector('img')) avatar.replaceChildren(document.createTextNode([...role.name.trim()][0] || '角'));
      const title = button(role.name, 'project-cast-name', () => roleDialog(role.id));
      const voice = hooks.resolveVoice(role.voiceKey), description = node('small', voice ? '' : 'needs-assignment', voice ? voice.voiceName : '待设置 · 还没选择声音');
      title.title = role.name; description.title = description.textContent;
      info.append(title, description); profile.append(avatar, info);
      const meta = node('div', 'project-cast-meta');
      const settings = M.optionsFor(project, { line: M.line('', role.id), chapter: project.chapters[0], ci: 0, li: 0 }, hooks.resolveVoice);
      let state = null;
      if (settings?.mode === 'design' && settings.lockVoice) {
        state = node('span', 'project-cast-state' + (settings.voiceAnchorId ? '' : ' needs-assignment'), settings.voiceAnchorId ? '已定声' : '待定声');
      } else if (!voice) {
        state = node('span', 'project-cast-state needs-assignment', '待设置');
      }
      const countsButton = button((counts.get(role.id) || 0) + ' 句', 'text-button', () => {
      chapterId = ''; resetFilters(); $('#project-filter-role').value = role.id; $('#project-generation-scope').value = 'filtered'; render(); $('#project-lines').scrollIntoView({ block: 'start' });
      });
      countsButton.prepend(libraryIcon('audio-lines')); countsButton.title = '只看「' + role.name + '」的台词'; countsButton.setAttribute('aria-label', role.name + ' · ' + (counts.get(role.id) || 0) + ' 句，查看台词');
      const change = button(voice ? '声音设置' : '选择声音', 'project-cast-settings', () => roleDialog(role.id));
      change.prepend(libraryIcon('headset')); change.append(libraryIcon('arrow-right'));
      meta.append(countsButton); if (state) meta.append(state);
      item.append(profile, meta, change); list.append(item);
    }
  }
  function render() {
    if (!project) return;
    derived = null; $('#project-title').value = project.name; $('#project-undo').disabled = !undo.length;
    renderMeta(); renderChapters(); renderCast(); renderMix();
    fillRoles($('#project-filter-role'), '全部角色', true); fillRoles($('#project-bulk-role'), '不改角色', true);
    const destination = $('#project-bulk-chapter'), previous = destination.value; destination.replaceChildren(); option(destination, '', '不移动章节');
    project.chapters.forEach(chapter => option(destination, chapter.id, '移到：' + chapter.name)); destination.value = previous;
    renderLines(); window.CustomSelects?.sync();
  }
  function renderLines() {
    const entries = filtered(), pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE)); page = Math.max(1, Math.min(page, pages));
    const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), list = $('#project-lines'); list.replaceChildren();
    $('#project-filter-count').textContent = entries.length + ' 条台词'; renderFilters();
    $('#project-chapter-summary').textContent = (chapterId ? contexts().filter(entry => entry.chapter.id === chapterId) : contexts()).length + ' 条台词';
    for (const entry of slice) {
      const { line, chapter, li } = entry, row = node('article', 'project-line-row'); row.dataset.lineId = line.id;
      const top = node('div', 'project-line-top'), check = node('input'); check.type = 'checkbox'; check.checked = selected.has(line.id); check.setAttribute('aria-label', '选择第 ' + (li + 1) + ' 条台词');
      check.onchange = () => { if (check.checked) selected.add(line.id); else selected.delete(line.id); renderSelection(true); window.CustomSelects?.sync(); };
      const number = node('span', 'project-line-number', !chapterId ? chapter.name + ' · ' + (li + 1) : String(li + 1).padStart(3, '0'));
      const role = node('select'); role.dataset.selectKind = 'project-role'; role.setAttribute('aria-label', '第 ' + (li + 1) + ' 条台词的角色'); option(role, '', '待分配角色');
      project.roles.forEach(item => { option(role, item.id, item.name); role.lastElementChild.dataset.voiceKey = item.voiceKey; }); option(role, '__new', '＋ 新增角色'); role.value = line.roleId;
      role.onchange = () => { if (role.value === '__new') { role.value = line.roleId; roleDialog(null, line.id); return; } mutate(() => { line.roleId = role.value; }); };
      const emotion = node('select'); emotion.setAttribute('aria-label', '第 ' + (li + 1) + ' 条台词的语气'); emotion.dataset.selectKind = 'emotion';
      const owner = project.roles.find(item => item.id === line.roleId), defaultEmotion = hooks.emotions.find(item => item.id === owner?.emotion)?.name || '自然';
      option(emotion, '', '跟随角色 · ' + defaultEmotion); hooks.emotions.forEach(item => option(emotion, item.id, item.name)); emotion.value = line.emotion;
      const locked = entry.options?.mode === 'design' && entry.options.lockVoice !== false;
      emotion.disabled = locked || entry.options?.mode === 'clone' && entry.options.referenceStyle !== 'expressive' || entry.options?.mode === 'preset' && entry.options.engine === 'light';
      if (locked) { emotion.value = ''; emotion.title = '固定人物声音沿用定声样本的表达；在角色设置中关闭后可逐句调整。'; }
      emotion.onchange = () => mutate(() => { line.emotion = emotion.value; });
      const badge = node('span', 'project-line-status ' + entry.status, labels[entry.status]);
      top.append(check, number, role, badge);
      const text = node('textarea'); text.rows = 2; text.value = line.text; text.maxLength = 50000; text.spellcheck = false; text.setAttribute('aria-label', '第 ' + (li + 1) + ' 条项目台词');
      editInput(text, value => { line.text = value; });
      text.placeholder = '输入这句台词…';
      text.title = 'Ctrl / ⌘ + Enter 在下方添加台词，沿用当前角色';
      text.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); guard(() => insertLine(entry))(); }
      });
      const bottom = node('div', 'project-line-bottom'), details = node('details', 'project-line-performance'), summary = node('summary', '', '表演');
      summary.prepend(libraryIcon('sliders-horizontal')); summary.title = '语气、节奏、表演要求与文件名';
      const fields = node('div', 'project-line-fields'), pace = node('select'); pace.setAttribute('aria-label', '第 ' + (li + 1) + ' 条台词节奏');
      for (const [value, label] of [['', '跟随角色节奏'], ['slow', '慢一些'], ['normal', '自然'], ['fast', '快一些']]) option(pace, value, label);
      pace.value = line.pace; pace.onchange = () => mutate(() => { line.pace = pace.value; });
      pace.disabled = emotion.disabled;
      if (locked) pace.value = '';
      const filename = node('input'); filename.value = line.filename; filename.maxLength = 80; filename.placeholder = '自动按章节和台词顺序命名'; filename.setAttribute('aria-label', '第 ' + (li + 1) + ' 条台词文件名');
      const instruction = node('input'); instruction.value = line.instruction || ''; instruction.maxLength = 500; instruction.placeholder = '表演要求（选填，默认跟随角色）'; instruction.setAttribute('aria-label', '第 ' + (li + 1) + ' 条台词表演要求'); instruction.disabled = emotion.disabled;
      if (locked) instruction.value = '';
      const field = (label, control) => { const wrapper = node('label', 'project-line-field'); wrapper.append(node('span', '', label), control); return wrapper; };
      editInput(instruction, value => { line.instruction = value; }); editInput(filename, value => { line.filename = value; });
      if (emotion.disabled) { const note = button('跟随角色表达', 'project-expression-inherited', () => roleDialog(line.roleId)); note.prepend(libraryIcon('users')); fields.append(note); }
      fields.append(field('语气', emotion), field('节奏', pace), field('表演要求', instruction), field('文件名', filename)); details.append(summary, fields);
      const actions = node('div', 'project-line-actions');
      const listen = button('试听', 'text-button project-line-listen', () => play(contexts().find(item => item.line.id === line.id)?.clips || [])); listen.disabled = !entry.clips.length;
      const generate = button('', 'text-button project-line-generate', () => { const current = contexts().find(item => item.line.id === line.id); return produce([current], current?.status === 'complete'); });
      const versions = button('版本 / 波形', 'text-button project-line-versions', () => openLineEditor(line.id)); versions.disabled = !entry.clips.length || entry.status === 'pending';
      labelControl(listen, '试听', 'play', true); renderLineGeneration(generate, entry); labelControl(versions, '版本 / 波形', 'audio-lines', true);
      const move = (offset) => mutate(() => { const target = li + offset; [chapter.lines[li], chapter.lines[target]] = [chapter.lines[target], chapter.lines[li]]; });
      const up = button('上移', 'project-line-move', () => move(-1)); up.disabled = li === 0; up.setAttribute('aria-label', '上移这句台词'); up.prepend(libraryIcon('arrow-up'));
      const down = button('下移', 'project-line-move', () => move(1)); down.disabled = li === chapter.lines.length - 1; down.setAttribute('aria-label', '下移这句台词'); down.prepend(libraryIcon('arrow-down'));
      const more = node('details', 'project-line-more'), moreToggle = node('summary'); moreToggle.setAttribute('aria-label', '更多台词操作'); moreToggle.title = '添加、复制、移动或删除台词'; moreToggle.append(libraryIcon('ellipsis'));
      const menu = node('div', 'project-line-menu'); menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '台词操作');
      const add = button('在下方添加', '', () => insertLine(entry)); add.prepend(libraryIcon('plus'));
      const copy = button('复制台词', '', () => insertLine(entry, true)); copy.prepend(libraryIcon('copy', true));
      const remove = button('删除台词', 'project-line-delete', () => mutate(() => { chapter.lines.splice(li, 1); selected.delete(line.id); })); remove.prepend(libraryIcon('trash-2'));
      menu.append(add, copy, up, down, remove); more.append(moreToggle, menu);
      more.addEventListener('toggle', () => { if (more.open) document.querySelectorAll('.project-line-more[open]').forEach(other => { if (other !== more) other.open = false; }); });
      actions.append(listen, generate, versions, more);
      const nextLine = button('下一句', 'project-line-continue', () => insertLine(entry)); nextLine.prepend(libraryIcon('plus'));
      nextLine.title = '在下方添加台词，沿用当前角色 · Ctrl / ⌘ + Enter';
      bottom.append(details, nextLine, actions); row.append(top, text);
      if (line.instruction && !locked) row.append(node('p', 'project-line-cue', '表演要求：' + line.instruction));
      const quality = node('p', 'project-line-quality'); updateQuality(quality, entry); row.append(quality, bottom); list.append(row);
    }
    if (!slice.length) {
      const chapter = project.chapters.find(item => item.id === chapterId), hasFilters = $('#project-line-search').value || $('#project-filter-role').value || $('#project-filter-status').value;
      const empty = node('div', 'project-lines-empty');
      empty.append(libraryIcon(hasFilters ? 'search' : 'mic'), node('strong', '', hasFilters ? '没有符合筛选条件的台词' : chapter && contexts().length ? '这个章节还没有台词' : '从第一句，开始创作'));
      const start = button(hasFilters ? '清除筛选' : '写一句台词', 'button', hasFilters ? () => { resetFilters(); renderLines(); } : () => $('#project-add-line').click());
      empty.append(start); list.append(empty);
    }
    $('#project-page-info').textContent = page + ' / ' + pages + ' 页 · 每页 ' + PAGE_SIZE + ' 条';
    $('#project-previous').disabled = page <= 1; $('#project-next').disabled = page >= pages;
    $('#project-quick-pages').hidden = pages <= 1; $('#project-quick-previous').disabled = page <= 1; $('#project-quick-next').disabled = page >= pages;
    const jump = $('#project-page-jump'); jump.replaceChildren();
    for (let number = 1; number <= pages; number++) option(jump, String(number), '第 ' + number + ' 页 · ' + ((number - 1) * PAGE_SIZE + 1) + '–' + Math.min(entries.length, number * PAGE_SIZE) + ' 条');
    jump.value = String(page);
    $('.project-pagination').classList.toggle('is-single-page', pages <= 1);
    renderSelection(); syncPlayback(); window.CustomSelects?.sync();
  }
  function labelControl(control, label, icon, compact = false) {
    const signature = JSON.stringify([label, icon, compact]);
    if (control.dataset.controlLabel === signature) return;
    control.dataset.controlLabel = signature;
    const copy = node('span', compact ? 'sr-only' : '', label); control.replaceChildren(libraryIcon(icon), copy);
    control.title = label; if (compact) control.setAttribute('aria-label', label);
  }
  function generationPhase(job) {
    return job.stopping ? 'stopping' : job.pausing ? 'pausing' : job.status;
  }
  function generationControl(control, label, phase, icon, disabled) {
    const busy = ['submitting', 'running', 'queued', 'stopping', 'pausing'].includes(phase);
    labelControl(control, label, icon);
    control.disabled = disabled;
    control.classList.add('generation-feedback');
    control.classList.toggle('is-loading', busy);
    control.dataset.generationState = phase;
    control.setAttribute('aria-busy', String(busy));
    if (phase === 'running' && !control.querySelector('.generation-wave')) {
      const wave = node('span', 'generation-wave'); wave.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 4; i++) wave.append(node('i'));
      control.querySelector('.ui-icon').append(wave);
    }
  }
  function renderLineGeneration(control, entry) {
    const phase = submittingLineIds.has(entry.line.id) ? 'submitting' : entry.generationJob ? generationPhase(entry.generationJob) : 'idle';
    const label = { submitting: '正在提交…', running: '生成中…', queued: '排队中…', scheduled: '等待预约', paused: '托管已暂停', stopping: '正在停止…', pausing: '正在暂停…' }[phase];
    generationControl(control, label || (entry.status === 'complete' ? '重做这句' : '生成这句'), phase,
      phase === 'scheduled' ? 'clock' : phase === 'paused' ? 'pause' : label || entry.status === 'complete' ? 'refresh-cw' : 'sparkles',
      submitting || !entry.line.text.trim() || entry.status === 'pending');
  }
  function insertLine(entry, duplicate = false) {
    mutate(() => {
      const chapter = project.chapters.find(chapter => chapter.id === entry.chapter.id), index = chapter.lines.findIndex(line => line.id === entry.line.id);
      const added = M.line(duplicate ? entry.line.text : '', entry.line.roleId);
      if (duplicate) { added.emotion = entry.line.emotion; added.pace = entry.line.pace; added.instruction = entry.line.instruction || ''; }
      chapter.lines.splice(index + 1, 0, added); chapterId = chapter.id; resetFilters(); $('#project-generation-scope').value = 'filtered'; page = Math.ceil((index + 2) / PAGE_SIZE);
    });
    const chapter = project.chapters.find(chapter => chapter.id === chapterId), index = chapter.lines.findIndex(line => line.id === entry.line.id) + 1;
    $('#project-lines [data-line-id="' + chapter.lines[index].id + '"]>textarea').focus();
  }
  function renderFilters() {
    const status = $('#project-filter-status').value, role = $('#project-filter-role').value, query = $('#project-line-search').value;
    const entries = contexts().filter(entry => (!chapterId || entry.chapter.id === chapterId) && (!role || (role === '__unassigned' ? !entry.line.roleId : entry.line.roleId === role)) && (!query || entry.line.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
    document.querySelectorAll('[data-line-status]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.lineStatus === status));
      button.lastElementChild.textContent = entries.filter(entry => !button.dataset.lineStatus || (button.dataset.lineStatus === 'todo' ? !['complete', 'pending'].includes(entry.status) : entry.status === button.dataset.lineStatus)).length;
    });
    const extra = !!role || !!status && !['todo', 'complete'].includes(status);
    if (extra) { $('#project-extra-filters').hidden = false; $('#project-filter-toggle').setAttribute('aria-expanded', 'true'); }
    $('#project-filter-toggle').classList.toggle('has-filters', !!role || !!status);
    document.querySelectorAll('.project-cast-item').forEach(card => card.classList.toggle('is-active', card.dataset.roleId === role));
  }
  function renderSelection(changeScope = false) {
    const visible = filtered().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), count = visible.filter(entry => selected.has(entry.line.id)).length;
    $('#project-select-page').checked = !!visible.length && count === visible.length; $('#project-select-page').indeterminate = count > 0 && count < visible.length;
    $('#project-select-page').disabled = !visible.length; $('#project-bulk').hidden = !selected.size;
    $('#project-selected-count').textContent = '已选择 ' + selected.size + ' 条台词（含其他页）';
    if (selected.size && changeScope) $('#project-generation-scope').value = 'selected';
    else if (!selected.size && $('#project-generation-scope').value === 'selected') $('#project-generation-scope').value = 'filtered';
    renderProduction();
  }
  function renderProduction() {
    if (!project) return;
    const entries = scoped().filter(entry => entry.line.text.trim()), count = status => entries.filter(entry => entry.status === status).length;
    const todo = entries.filter(entry => !['complete', 'pending'].includes(entry.status)).length;
    const scope = $('#project-generation-scope').value, chapter = project.chapters.find(item => item.id === chapterId);
    const name = { all: '整个项目', chapter: chapter?.name || '全部章节', selected: '选中台词', filtered: chapter?.name || '全部章节' }[scope];
    $('#project-production-summary').textContent = name + (scope === 'filtered' ? ' · 筛选结果' : '') + ' ' + entries.length + ' 句 · 已完成 ' + count('complete') + ' · 待处理 ' + todo + (count('pending') ? ' · 处理中 ' + count('pending') : '');
    const unresolved = entries.filter(needsSetup), unassigned = unresolved.filter(entry => !project.roles.some(role => role.id === entry.line.roleId)).length;
    const missingPackages = entries.some(entry => entry.options && !hooks.ready(entry.options));
    const ignoredFilters = ['all', 'chapter'].includes(scope) && ($('#project-line-search').value || $('#project-filter-role').value || $('#project-filter-status').value);
    $('#project-production-hint').textContent = unresolved.length ? (unassigned ? unassigned + ' 句还没有角色。' : '') + (unresolved.length > unassigned ? (unresolved.length - unassigned) + ' 句需要完善角色声音。' : '') + '点击下方入口处理后即可生成。' + (missingPackages ? ' 所需声音包尚未安装，可先准备声音包。' : '') : missingPackages && todo ? '角色声音已选好，还需要准备对应的声音包。安装后可离线生成。' : ignoredFilters ? '此范围包含筛选外的台词。只处理眼前的内容，请选择“当前筛选结果”。' : !entries.length ? '此范围没有可生成的台词。导入文案、添加台词或调整范围。' : (scope === 'filtered' && entries.length > PAGE_SIZE ? '包含所有页的匹配台词。' : '') + '长文自动分批在后台处理，已完成且未修改的台词会跳过。';
    const globalUnresolved = contexts().filter(needsSetup);
    $('#project-fix-roles').hidden = !globalUnresolved.length;
    $('#project-fix-roles').textContent = '配好角色 · ' + globalUnresolved.length;
    $('#project-prepare-voices').hidden = !missingPackages || !todo;
    // Jobs stay active after submission, and can outlive a "not generated" filter.
    // Only actual audio completion with no active task may show the finished label.
    const candidates = scoped(scope, true).filter(entry => entry.line.text.trim());
    const byId = new Map(candidates.map(entry => [entry.line.id, entry])), versions = new Map();
    const jobs = hooks.media().jobs.filter(job => job.projectId === project.id && ['queued', 'scheduled', 'running', 'paused'].includes(job.status) && job.rows.some(row => {
      const entry = byId.get(row.lineId); if (!entry?.options) return false;
      if (!versions.has(row.lineId)) versions.set(row.lineId, M.fingerprint(entry.options));
      return row.lineVersion === versions.get(row.lineId);
    }));
    const job = jobs.find(job => job.stopping || job.pausing) || jobs.find(job => job.status === 'running') || jobs.find(job => job.status === 'queued') || jobs.find(job => job.status === 'scheduled') || jobs[0];
    const activeIds = new Set(jobs.flatMap(job => job.rows.map(row => row.lineId)));
    const generating = candidates.filter(entry => activeIds.has(entry.line.id)), done = generating.filter(entry => entry.status === 'complete').length;
    const complete = entries.length > 0 && entries.every(entry => entry.status === 'complete');
    const phase = submitting ? 'submitting' : job ? generationPhase(job) : complete ? 'complete' : 'idle';
    const generationLabel = { submitting: '正在提交…', running: done === generating.length ? '正在收尾…' : '生成中 · ' + done + '/' + generating.length, queued: '排队中…', scheduled: '等待预约', paused: '托管已暂停', stopping: '正在停止…', pausing: '正在暂停…' }[phase];
    generationControl($('#project-generate'), generationLabel || (todo ? '生成 ' + todo + ' 句' : complete ? '已全部生成' : '暂无待生成'), phase,
      phase === 'scheduled' ? 'clock' : phase === 'paused' ? 'pause' : generationLabel ? 'refresh-cw' : complete ? 'check' : 'sparkles', submitting || !!job || !todo);
    $('#project-managed').disabled = submitting;
    $('#project-export').disabled = !entries.some(entry => entry.clips.length);
    $('#project-delivery').disabled = !entries.length;
    $('#project-listen').disabled = !listening && !entries.some(entry => entry.clips.length);
    const clips = entries.reduce((sum, entry) => sum + entry.clips.length, 0);
    $('#project-export-summary').textContent = clips ? '此范围可保存 ' + clips + ' 段音频' + (count('complete') < entries.length ? '，未完成台词仅含已有片段' : '') : '此范围生成后可试听和保存';
    $('#project-overall-progress').max = Math.max(1, entries.length); $('#project-overall-progress').value = count('complete');
    $('#project-progress-label').textContent = count('complete') + ' / ' + entries.length + ' 句';
    $('#project-scope-note').textContent = count('pending') ? count('pending') + ' 句处理中' : ignoredFilters ? '含筛选外台词' : scope === 'selected' ? '已选台词' : todo ? '待配音 ' + todo : entries.length ? '已完成' : '当前范围暂无台词';
    $('#project-progress-label').title = $('#project-production-summary').textContent;
    $('#project-prepare-voices').title = $('#project-production-hint').textContent;
    const globalTodo = contexts().filter(entry => entry.line.text.trim() && !['complete', 'pending'].includes(entry.status)).length;
    $('#project-reveal-work').hidden = !!todo || !globalTodo;
    $('#project-reveal-work').textContent = '查看待配音 · ' + globalTodo;
    document.querySelectorAll('[data-project-target]').forEach(button => button.setAttribute('aria-pressed', String((Number(button.dataset.projectTarget) || 0) === (project.targetSeconds || 0))));
    if (document.activeElement !== $('#project-target-seconds')) $('#project-target-seconds').value = project.targetSeconds || '';
    $('#project-duration-estimate').textContent = '整个项目 · ' + durationLabel(contexts());
    renderManagedStatus(); renderWorkflow(); renderDelivery(); window.CustomSelects?.sync();
  }
  function deliveryScopeLabel(scope) {
    const chapter = project.chapters.find(item => item.id === chapterId);
    return { all: '整个项目', chapter: chapter?.name || '全部章节', selected: '选中台词', filtered: (chapter?.name || '全部章节') + ' · 当前筛选结果' }[scope];
  }
  function durationLabel(entries, pause = project.deliverySettings?.pauseMs ?? M.DELIVERY_DEFAULTS.pauseMs, target = project.targetSeconds) {
    const estimate = M.durationEstimate(entries, pause);
    const delta = target ? estimate.seconds - target : 0;
    return (estimate.estimated ? '预计 ' : '已生成音频合计 ') + estimate.seconds.toFixed(1) + ' 秒（含句间停顿）' +
      (target ? ' · 目标 ' + target + ' 秒，' + (Math.abs(delta) < .5 ? '接近目标。' : (delta > 0 ? '超出 ' : '还差 ') + Math.abs(delta).toFixed(1) + ' 秒。可调整文稿或角色语速后重新生成。') : '。') +
      (estimate.estimated ? ' 估算仅供安排文稿，实际以生成音频为准。' : '');
  }
  function deliverySettings() {
    return { sampleRate: 48000, normalize: $('#project-delivery-normalize').checked, trimSilence: $('#project-delivery-trim').checked,
      pauseMs: Number($('#project-delivery-pause').value), includeSegments: $('#project-delivery-segments').checked };
  }
  function closeDelivery() {
    $('#project-delivery-dialog').close();
    if (deliveryProjectId === project?.id && deliveryReturnFocus?.isConnected && !deliveryReturnFocus.disabled) deliveryReturnFocus.focus({ preventScroll: true });
  }
  function dismissDeliveryForNavigation() {
    deliveryCloseAfterCancel = false; deliveryProjectId = ''; deliveryReturnFocus = null;
    delivery.reset(); if ($('#project-delivery-dialog').open) $('#project-delivery-dialog').close();
  }
  function requestDeliveryClose() {
    if (!delivery.active()) return closeDelivery();
    $('#project-delivery-close-confirm').hidden = false;
    $('#project-delivery-keep').focus();
  }
  function openDelivery() {
    if (!project) return;
    if ($('#project-delivery-dialog').open) return;
    deliveryProjectId = project.id; deliveryReturnFocus = $('#project-delivery'); deliveryReviewKey = ''; deliveryCloseAfterCancel = false;
    $('#project-delivery-scope').value = $('#project-generation-scope').value;
    $('#project-delivery-completeness').value = 'complete'; $('#project-delivery-partial-confirm').checked = false;
    $('#project-delivery-close-confirm').hidden = true;
    delivery.reset(); $('#project-delivery-dialog').showModal(); renderDelivery();
    $('#project-delivery-scope-trigger')?.focus();
  }
  function renderDelivery() {
    if (!$('#project-delivery-dialog').open || !project || deliveryProjectId !== project.id) return;
    const state = delivery.getState(), active = delivery.active(), complete = state.phase === 'complete';
    const scope = $('#project-delivery-scope').value, readiness = M.deliveryReadiness(scoped(scope));
    const frozen = active || complete ? state.snapshot : null, summary = frozen?.summary || readiness;
    const reviewKey = JSON.stringify(readiness.entries.map(entry => [entry.line.id, entry.status, ...entry.clips.map(clip => clip.id)]));
    if (!active && reviewKey !== deliveryReviewKey) { $('#project-delivery-partial-confirm').checked = false; deliveryReviewKey = reviewKey; }
    $('#project-delivery-name').textContent = (frozen?.projectName || project.name) + ' · ' + (frozen?.scopeLabel || deliveryScopeLabel(scope));
    $('#project-delivery-ready').textContent = frozen?.partial ? '节选 · ' + summary.complete + ' / ' + summary.total + ' 句' : summary.complete === summary.total && summary.total ? '范围完整 · ' + summary.total + ' 句' : '已完成 ' + summary.complete + ' / ' + summary.total + ' 句';
    $('#project-delivery-counts').textContent = '缺失 ' + summary.missing + '　需更新 ' + summary.changed + '　处理中 ' + summary.pending;
    if (!active && !complete) $('#project-delivery-duration').textContent = durationLabel(readiness.ready, Number($('#project-delivery-pause').value) || 0, scope === 'all' ? project.targetSeconds : 0) + ($('#project-delivery-trim').checked ? ' · 开启静音裁剪后会缩短' : '') + (scope !== 'all' && project.targetSeconds ? ' · 全项目目标 ' + project.targetSeconds + ' 秒' : '');
    const partial = summary.complete < summary.total && $('#project-delivery-completeness').value === 'available';
    $('#project-delivery-partial').hidden = !partial;
    $('#project-delivery-partial-note').textContent = '导出 ' + summary.complete + ' 句，跳过 ' + (summary.total - summary.complete) + ' 句；文件会标记为节选。';
    $('#project-delivery-settings').disabled = active || complete;
    // The custom select buttons mirror each select, including during an in-flight export.
    for (const selector of ['#project-delivery-scope', '#project-delivery-completeness']) $(selector).disabled = active || complete;
    const submit = $('#project-delivery-submit');
    submit.hidden = complete;
    submit.disabled = active || complete || !readiness.complete || (!readiness.canExport && !(partial && $('#project-delivery-partial-confirm').checked));
    submit.textContent = active ? state.phase === 'cancelling' ? '正在停止…' : '正在导出…' : state.phase === 'failed' ? '重试导出' : partial ? '导出节选 ZIP' : '导出成品 ZIP';
    const cancel = $('#project-delivery-cancel');
    cancel.textContent = active ? '停止导出' : complete ? '完成' : '取消'; cancel.disabled = state.phase === 'cancelling';
    $('#project-delivery-stop-close').disabled = state.phase === 'cancelling';
    $('#project-delivery-progress-panel').hidden = !active && state.phase !== 'cancelled';
    const phases = { queued: '等待配音引擎空闲', scan: '检查音频与音量', render: '合并音频与生成字幕', zip: '整理成品文件', save: '保存成品 ZIP' };
    $('#project-delivery-progress-title').textContent = state.phase === 'cancelled' ? '已取消导出，设置已保留' : state.phase === 'cancelling' ? '正在停止本次导出…' : phases[state.progress?.phase] || '准备成品导出…';
    const progress = $('#project-delivery-progress');
    if (active && state.progress?.total > 0) { progress.max = state.progress.total; progress.value = Math.min(state.progress.current || 0, state.progress.total); }
    else progress.removeAttribute('value');
    progress.hidden = !active;
    $('#project-delivery-progress-detail').textContent = state.phase === 'cancelled' ? '可调整设置后重新导出，原始配音已保留。' : (state.progress?.message || '选择保存位置后，按此次台词与设置快照处理。') + (state.progress?.total > 0 ? ' · ' + (state.progress.current || 0) + ' / ' + state.progress.total + ' 段' : '');
    $('#project-delivery-success').hidden = !complete;
    if (complete) {
      const seconds = Math.round(Number(state.result?.durationSeconds)), duration = Number.isFinite(seconds) ? ' · ' + Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒' : '';
      $('#project-delivery-success-title').textContent = frozen.partial ? '节选成品已保存' : '成品已保存';
      $('#project-delivery-success-detail').textContent = frozen.projectName + ' · ' + frozen.exportedLines + ' 句 / ' + (state.result?.count || frozen.items.length) + ' 段' + duration + '。' + (frozen.partial ? '已跳过 ' + frozen.skippedLines + ' 句；这是所选范围的节选。' : '所选范围已完整导出。') + '包含 WAV、MP3、SRT、处理清单' + (frozen.settings.includeSegments ? '与原始分段备份。' : '。');
    }
    const warnings = $('#project-delivery-warnings'); warnings.replaceChildren();
    const warningLabels = {
      ORIGINAL_CLIPPING: '原音频有削波，音量处理无法恢复已有失真，建议试听或重做。',
      SILENT_AUDIO: '检测到静音段，请检查台词是否正常发声。',
      NO_ACTIVE_AUDIO: '未检测到明显有效语音，未强行放大，请试听确认。',
      STEREO_DOWNMIX: '立体声音频已合为单声道，请确认声道效果。',
      GAIN_LIMITED: '为避免过度放大，音量增益已限制；部分台词可能仍偏轻。',
      PEAK_LIMITED: '为避免新增削波，已限制音量增益；各句响度可能仍有差异。'
    }, warningGroups = new Map();
    for (const warning of state.result?.warnings || []) {
      const label = typeof warning === 'string' ? warning : warning.message || warningLabels[warning.code] || '请查看处理清单中的音频质量提醒。';
      warningGroups.set(label, (warningGroups.get(label) || 0) + 1);
    }
    for (const [label, count] of warningGroups) warnings.append(node('li', '', (count > 1 ? count + ' 段：' : '') + label));
    warnings.hidden = !warnings.childElementCount;
    $('#project-delivery-error').textContent = state.error ? cleanError(state.error) + '。设置已保留，可重试。' : !active && !complete && !readiness.canExport && !partial ? (readiness.total ? '此范围尚未完整。请补齐台词，或选择“仅已完成台词”并确认节选。' : '此范围没有台词，请调整范围。') : '';
    if (!active) $('#project-delivery-close-confirm').hidden = true;
    window.CustomSelects?.sync();
    if (deliveryCloseAfterCancel && !active) {
      deliveryCloseAfterCancel = false;
      if (complete) hooks.toast('成品已保存，停止请求未赶上保存完成。');
      closeDelivery();
    }
  }
  async function submitDelivery(event) {
    event.preventDefault(); if (delivery.active() || deliveryProjectId !== project?.id) return;
    renderDelivery(); if ($('#project-delivery-submit').disabled || !$('#project-delivery-form').reportValidity()) return;
    try {
      const snapshot = M.deliverySnapshot({ project, entries: scoped($('#project-delivery-scope').value), settings: deliverySettings(),
        allowPartial: $('#project-delivery-completeness').value === 'available' && $('#project-delivery-partial-confirm').checked,
        scopeLabel: deliveryScopeLabel($('#project-delivery-scope').value) });
      await delivery.submit(snapshot);
    } catch (error) { $('#project-delivery-error').textContent = cleanError(error); }
  }
  function renderManagedStatus() {
    const job = hooks.media().jobs.filter(job => job.projectId === project.id && job.managed).at(-1);
    $('#project-managed-status').hidden = !job;
    if (!job) return;
    const labels = { queued: '已加入托管，轮到后开始', scheduled: '已预约托管', running: '托管配音进行中', paused: '托管已暂停', complete: '托管已完成', partial: '托管已结束，有段落需要补做', interrupted: '托管已中断，可接着生成', cancelled: '托管已停止', failed: '托管需要处理' };
    $('#project-managed-title').textContent = job.pausing ? '当前段保存后暂停' : labels[job.status];
    $('#project-managed-progress').max = job.total; $('#project-managed-progress').value = job.cursor;
    $('#project-managed-summary').textContent = '本次任务已保存 ' + job.completed + ' / ' + job.total + ' 段' + (job.failedRows?.length ? ' · 待补做 ' + job.failedRows.length + ' 段' : '') + (job.status === 'scheduled' ? ' · ' + new Date(job.scheduledAt).toLocaleString('zh-CN') + ' 开始' : job.stage === 'retrying' ? ' · 当前段正在自动重试（' + job.retryAttempt + ' / 2）' : ' · 音频自动保存在本机');
  }
  function managedEntries() {
    return ($('#managed-scope').value === 'all' ? contexts() : scoped()).filter(entry => entry.line.text.trim());
  }
  function renderManaged() {
    derived = null;
    const entries = managedEntries(), valid = entries.filter(entry => !['complete', 'pending'].includes(entry.status));
    const missing = valid.some(needsSetup), packages = valid.some(entry => entry.options && !hooks.ready(entry.options));
    $('#managed-project-name').textContent = project.name;
    $('#managed-preview-summary').textContent = new Set(valid.map(entry => entry.chapter.id)).size + ' 个章节 · ' + valid.length + ' 条台词 · ' + valid.reduce((sum, entry) => sum + entry.line.text.length, 0).toLocaleString('zh-CN') + ' 字';
    $('#managed-preview-skipped').textContent = '已完成的 ' + entries.filter(entry => entry.status === 'complete').length + ' 句会跳过' + (entries.some(entry => entry.status === 'pending') ? '；已在任务中的台词不会重复提交' : '，按章节和台词顺序处理');
    $('#managed-error').textContent = !valid.length ? '此范围已完成，或已加入其他任务。可在后台任务中查看进度。' : missing ? '还有台词需要分配角色或完善声音，请先处理后再托管。' : packages ? '这些角色还需要准备声音包。准备好后，托管可以离线完成。' : '';
    $('#managed-fix').hidden = !missing && !packages;
    $('#managed-fix').textContent = missing ? '去完善角色声音 →' : '去准备声音包 →';
    $('#managed-fix').onclick = () => { $('#managed-dialog').close(); if (missing) fixRoles(valid); else hooks.downloads(); };
    $('#managed-submit').disabled = submitting || !valid.length || missing || packages;
    window.CustomSelects?.sync();
    return valid;
  }
  function openManaged() {
    $('#managed-scope').value = 'all';
    document.querySelector('[name="managed-start"][value="now"]').checked = true;
    $('#managed-time-field').hidden = true; $('#managed-time').required = false; $('#managed-submit').textContent = '开始托管';
    const tonight = new Date(); tonight.setHours(23, 0, 0, 0); if (tonight <= new Date()) tonight.setDate(tonight.getDate() + 1);
    const localTime = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#managed-time').value = localTime(tonight); $('#managed-time').min = localTime(new Date(Date.now() + 60000));
    renderManaged(); $('#managed-dialog').showModal();
  }
  function refreshMedia() {
    if (!project || $('#project-detail').hidden || $('#view-projects').classList.contains('hidden')) return;
    derived = null;
    const byId = new Map(contexts().map(entry => [entry.line.id, entry]));
    const list = $('#project-lines'), rows = [...list.querySelectorAll('[data-line-id]')];
    const visible = filtered().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const editing = list.contains(document.activeElement) && document.activeElement.matches('textarea,input:not([type="checkbox"])') || list.querySelector('[aria-expanded="true"]');
    if (!editing && (rows.length !== visible.length || rows.some((row, index) => row.dataset.lineId !== visible[index]?.line.id))) {
      renderLines(); return;
    }
    rows.forEach(row => {
      const entry = byId.get(row.dataset.lineId); if (!entry) return;
      const badge = row.querySelector('.project-line-status'); badge.className = 'project-line-status ' + entry.status; badge.textContent = labels[entry.status];
      row.querySelector('.project-line-listen').disabled = !entry.clips.length;
      row.querySelector('.project-line-versions').disabled = !entry.clips.length || entry.status === 'pending';
      updateQuality(row.querySelector('.project-line-quality'), entry);
      renderLineGeneration(row.querySelector('.project-line-generate'), entry);
    });
    renderProduction(); renderFilters();
    renderMix();
  }
  function updateQuality(element, entry) {
    const messages = [...new Set(entry.clips.flatMap(clip => (clip.editedQuality || clip.quality)?.messages || []))];
    element.textContent = messages.length ? '建议试听核对：' + messages.join('；') : '';
    element.hidden = !messages.length;
  }
  async function openLineEditor(lineId) {
    stopAudio(); const entry = contexts().find(entry => entry.line.id === lineId), owner = project.id;
    if (!entry) return;
    const versions = M.takeVersions(entry, entry.options, M.audioIndex(hooks.media().history, owner));
    if (!versions.length) return hooks.toast('这句还没有可试听的版本');
    const selectedId = entry.clips[0]?.options.lineTakeId || M.LEGACY_TAKE_ID;
    return hooks.audioEditor({ title: '这句台词的版本与波形', versions, selectedId,
      onSelect: async version => {
        if (project?.id !== owner) throw new Error('项目已经切换，请重新选择版本');
        mutate(() => { const line = M.entries(project).find(entry => entry.line.id === lineId)?.line; if (!line) throw new Error('这句台词已删除'); line.selectedTake = { id: version.id, version: version.version }; });
        await save();
      } });
  }
  function voiceChoices(select, placeholder = '稍后选择声音') {
    select.replaceChildren(); option(select, '', placeholder);
    hooks.voices().forEach(voice => option(select, voice.key, voice.name));
  }
  function roleDialog(id, target) {
    editingRoleId = id; roleTarget = target || null;
    draftRoleId = id || crypto.randomUUID();
    const role = project.roles.find(role => role.id === id), options = role ? { ...hooks.resolveVoice(role.voiceKey), ...role.options } : {};
    preparedRoleVoice = options.voiceAnchorId ? { voiceAnchorId: options.voiceAnchorId, signature: options.voiceAnchorSignature } : null;
    editingVoiceRevision = options.voiceRevision || ''; roleEngineOverride = options.engine || '';
    $('#project-role-lock-voice').checked = options.lockVoice !== false;
    $('#project-role-reference-style').value = options.referenceStyle || 'original';
    $('#project-role-heading').textContent = role ? '设置角色 · ' + role.name : '新增角色';
    $('#project-role-name').value = role?.name || ''; $('#project-role-aliases').value = role?.aliases.join('、') || '';
    voiceChoices($('#project-role-voice')); $('#project-role-voice').value = role?.voiceKey || '';
    $('#project-role-emotion').value = role?.emotion || 'natural'; $('#project-role-pace').value = role?.pace || 'normal';
    $('#project-role-description').value = options.voiceDescription || ''; $('#project-role-instruction').value = options.instruction || ''; $('#project-role-intensity').value = options.intensity ?? 50;
    $('#project-role-error').textContent = ''; $('#project-role-delete').hidden = !role;
    rolePerformance(); window.CustomSelects?.sync(); $('#project-role-dialog').showModal();
    $('.role-dialog-body').scrollTop = 0;
    const missingDescription = options.mode === 'design' && !options.voiceDescription?.trim();
    if (missingDescription) {
      $('.project-role-advanced').open = true; $('#project-role-error').textContent = '请填写人物声线描述，让这个角色有明确的声音。'; $('#project-role-description').focus();
    } else { $('.project-role-advanced').open = false; (options.mode === 'design' && options.lockVoice !== false && !preparedRoleVoice ? $('#project-role-prepare-voice') : $('#project-role-name')).focus(); }
  }
  function rolePerformance() {
    const voice = hooks.resolveVoice($('#project-role-voice').value); if (voice && roleEngineOverride) voice.engine = roleEngineOverride;
    const expressive = $('#project-role-reference-style').value === 'expressive';
    const can = (voice?.mode !== 'clone' || expressive) && !(voice?.mode === 'preset' && voice.engine === 'light');
    $('#project-role-reference-fields').hidden = voice?.mode !== 'clone';
    const locked = voice?.mode === 'design' && $('#project-role-lock-voice').checked;
    const fallback = hooks.installedVoice?.();
    $('#project-role-installed').hidden = !fallback || voice?.mode === 'preset' && hooks.ready(voice);
    $('#project-role-installed-label').textContent = fallback ? '改用已安装音色：' + (hooks.resolveVoice(fallback.key)?.voiceName || '温宁') : '改用已安装音色';
    $('#project-role-lock-fields').hidden = voice?.mode !== 'design';
    $('#project-role-prepare-voice').hidden = !locked;
    $('#project-role-performance-note').hidden = can; $('#project-role-preview').disabled = !voice || !hooks.canPreview($('#project-role-voice').value);
    $('#project-role-performance-note').textContent = voice?.mode === 'clone' ? '沿用录音表达；切换上方的“调整语气与情绪”后可以设置表演。' : '轻松朗读使用自然语气，表演设置不参与生成。';
    $('#project-role-voice-note').textContent = voice?.mode === 'design' ? locked ? '先确定并试听，满意后保存。全部台词沿用同一声线与表达；修改声线或表达后需重新定声。' : '每句按人物描述创作，可单独调整表演，声线可能随台词变化。' : voice?.mode === 'clone' ? expressive ? '试听为原录音。生成时保留音色并调整表达；首次使用需确认下载可选资源，效果以试听为准。' : '试听为原始录音，新台词会延续这段录音的声线和表达。' : voice ? '试听为预存声音示例。保存后，这个角色的所有台词默认使用所选声音。' : '选择一个声音，再听听是否适合这个角色。';
    for (const id of ['project-role-emotion', 'project-role-pace', 'project-role-instruction', 'project-role-intensity']) $('#' + id).disabled = !can;
    $('#project-role-description').disabled = voice?.mode !== 'design';
    $('#project-role-description-field').hidden = voice?.mode !== 'design';
    const avatar = hooks.avatar($('#project-role-voice').value);
    if (!avatar.querySelector('img')) avatar.replaceChildren(document.createTextNode([...$('#project-role-name').value.trim()][0] || '角'));
    $('#project-role-portrait').replaceChildren(avatar);
    $('#project-role-voice-name').textContent = voice?.voiceName || '选一个喜欢的声音';
    $('#project-role-voice-kind').textContent = { preset: '精选配音声音', design: '人物创作声音', clone: '我的录音声音' }[voice?.mode] || '为角色选择声音';
    $('#project-role-preview').dataset.previewKey = $('#project-role-voice').value; hooks.syncPreview?.();
    $('.role-section-caption').textContent = locked ? '定声时使用这份表达' : '台词可单独调整';
    $('#project-role-intensity-value').value = $('#project-role-intensity').value + '%';
    updateRoleAnchorState();
    window.CustomSelects?.sync();
  }
  function updateRoleAnchorState() {
    const locked = hooks.resolveVoice($('#project-role-voice').value)?.mode === 'design' && $('#project-role-lock-voice').checked;
    let ready = false;
    if (preparedRoleVoice) {
      const role = roleFromForm(), draft = { ...project, roles: [...project.roles.filter(item => item.id !== role.id), role] };
      const options = M.optionsFor(draft, { line: M.line('', role.id), chapter: project.chapters[0], ci: 0, li: 0 }, hooks.resolveVoice);
      ready = !!options && preparedRoleVoice.signature === M.voiceSettingsSignature(options);
    }
    const status = $('#project-role-anchor-state'); status.hidden = !locked;
    status.textContent = ready ? '已定声 · 可直接保存' : preparedRoleVoice ? '设置已改变 · 需重新定声' : '待确定声音';
    status.dataset.state = ready ? 'ready' : 'pending';
    $('#project-role-reset-voice').hidden = !locked || !preparedRoleVoice;
  }
  function roleFromForm() {
    const previous = project.roles.find(role => role.id === editingRoleId), voiceKey = $('#project-role-voice').value;
    const voice = hooks.resolveVoice(voiceKey), sameVoice = previous?.voiceKey === voiceKey;
    const retained = Object.fromEntries(['scene', 'prefix', 'sampleRate'].filter(key => previous?.options?.[key] !== undefined).map(key => [key, previous.options[key]]));
    return { id: draftRoleId, name: $('#project-role-name').value.trim(), aliases: $('#project-role-aliases').value.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean),
      voiceKey, emotion: $('#project-role-emotion').value, pace: $('#project-role-pace').value,
      options: { ...retained, language: sameVoice ? previous.options?.language || voice?.language : voice?.language,
        engine: roleEngineOverride || (sameVoice ? previous.options?.engine || voice?.engine : voice?.engine),
        ...(voice?.mode === 'design' ? { lockVoice: $('#project-role-lock-voice').checked, voiceRevision: editingVoiceRevision } : {}),
        ...(voice?.mode === 'clone' ? { referenceStyle: $('#project-role-reference-style').value || 'original' } : {}),
        voiceDescription: $('#project-role-description').value, instruction: $('#project-role-instruction').value, intensity: Number($('#project-role-intensity').value) } };
  }
  function draftVoiceOptions(role = roleFromForm()) {
    const draft = { ...project, roles: [...project.roles.filter(item => item.id !== role.id), role] };
    M.validate(draft);
    return M.optionsFor(draft, { line: M.line('', role.id), chapter: project.chapters[0], ci: 0, li: 0 }, hooks.resolveVoice);
  }
  async function prepareRoleVoice() {
    if (preparingRoleVoice) return;
    const options = draftVoiceOptions();
    if (!options?.voiceDescription?.trim()) throw new Error('请先填写人物声线描述。');
    if (!hooks.ready(options)) {
      const projectId = project.id, originalRoleId = editingRoleId, originalRoleTarget = roleTarget, roleId = draftRoleId, engine = roleEngineOverride;
      const form = [...$('#project-role-form').querySelectorAll('input, select, textarea')].filter(control => control.id).map(control => [control.id, control.value, control.checked]);
      $('#project-role-dialog').close();
      hooks.downloads([options], null, project.name, { role: { originalRoleId, originalRoleTarget, roleId, engine, form } });
      hooks.toast('确定人物声音需要“人物与童声”和“我的专属声音”，准备后可返回继续。'); return;
    }
    const signature = M.voiceSettingsSignature(options), projectId = project.id, roleId = draftRoleId;
    preparingRoleVoice = true;
    const controls = [...$('#project-role-form').querySelectorAll('input, select, textarea, button')], disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; }); window.CustomSelects?.sync();
    $('#project-role-prepare-label').textContent = '正在确定声音…'; $('#project-role-prepare-voice').classList.add('is-loading');
    window.SoundFeedback?.set($('#project-role-prepare-voice'), 'loading');
    $('#project-role-prepare-voice').setAttribute('aria-busy', 'true'); $('#project-role-error').textContent = '';
    try {
      const result = await hooks.api('prepare-voice', options);
      if (project.id !== projectId || draftRoleId !== roleId || !$('#project-role-dialog').open) return;
      preparedRoleVoice = { voiceAnchorId: result.voiceAnchorId, signature };
      updateRoleAnchorState();
      $('#project-role-voice-note').textContent = '声音已确定，正在播放实际定声样本。满意后保存角色；调整声线或表达后需重新定声。';
      hooks.stopOtherAudio(); stopAudio();
      const bytes = Uint8Array.from(atob(result.audio), char => char.charCodeAt(0));
      audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio = new Audio(audioUrl);
      const token = playbackToken; audio.onended = () => { if (token === playbackToken) stopAudio(); }; audio.onerror = () => { if (token === playbackToken) { stopAudio(); $('#project-role-error').textContent = '试听暂时无法播放，请重试。'; } };
      audioFeedback = window.SoundFeedback?.bind(audio, $('#project-role-prepare-voice'), { initial: 'loading', stop: stopAudio });
      await audio.play();
    } finally {
      preparingRoleVoice = false; controls.forEach((control, index) => { control.disabled = disabled[index]; });
      $('#project-role-prepare-label').textContent = audio && !audio.paused ? '停止声音试听' : '确定并试听声音'; $('#project-role-prepare-voice').classList.remove('is-loading');
      $('#project-role-prepare-voice').setAttribute('aria-busy', 'false'); updateRoleAnchorState(); window.CustomSelects?.sync();
      if (!audio || audio.paused) window.SoundFeedback?.set($('#project-role-prepare-voice'));
    }
  }
  function setImportStep(step) {
    $('#project-import-dialog').dataset.step = step;
    const preview = step === 'preview';
    $('#project-import-source').hidden = preview;
    $('#project-import-preview-panel').hidden = !preview;
    $('#project-import-preview').hidden = preview;
    $('#project-import-apply').hidden = !preview;
    $('#project-import-apply').disabled = !preview;
    $('#project-import-subtitle').textContent = preview ? '核对角色和台词，让每一句都有合适的声音。' : '放入你的文字，让故事有声有色。';
    document.querySelectorAll('[data-import-step]').forEach(item => {
      if (item.dataset.importStep === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', preview && item.dataset.importStep === 'source');
    });
    $('#project-import-dialog .import-dialog-body').scrollTop = 0;
  }
  function syncImportSource() {
    const dialogue = $('#project-import-script-mode').value === 'dialogue';
    document.querySelectorAll('[name="project-import-kind"]').forEach(input => { input.checked = input.value === $('#project-import-script-mode').value; });
    $('#project-import-char-count').textContent = Array.from($('#project-import-text').value.replace(/\s/g, '')).length.toLocaleString() + ' 字';
    $('#project-import-mode-hint').textContent = dialogue ? '按「角色名：台词」识别说话人，下一步可逐条核对。' : '保留正文中的冒号和引号，整篇文案由同一角色朗读。';
    $('#project-import-text').placeholder = dialogue ? '第1章 森林里的早晨\n旁白：小兔子推开窗，看见了明亮的太阳。\n小兔子（开心）：今天我们去探险吧！\n熊爷爷：好呀，记得带上地图。' : '在这里粘贴课程讲稿、广告文案，或想要朗读的故事……\n\n每个段落将成为一条配音台词。\n章节可写成「第1章 标题」或「# 标题」。';
    const example = $('#project-import-format-example');
    example.replaceChildren(node('span', '', '第1章 森林里的早晨'));
    if (dialogue) {
      for (const [role, text] of [['旁白', '小兔子推开窗。'], ['小兔子（开心）', '今天我们去探险吧！']]) {
        const line = node('p'); line.append(node('b', '', role + '：'), document.createTextNode(text)); example.append(line);
      }
    } else example.append(node('p', '', '小兔子推开窗，看见了明亮的太阳。'), node('p', '', '新的一天，就这样开始了。'));
    $('#project-import-format-hint').textContent = dialogue ? '角色名后加冒号，括号里可写语气；导入后核对角色。' : '用空行分隔段落，用章节标题整理长文。';
  }
  function updateImportSummary() {
    if (!parsed) return;
    $('#project-import-chapter-count').textContent = parsed.chapters.length.toLocaleString();
    $('#project-import-line-count').textContent = parsed.count.toLocaleString();
    $('#project-import-role-count').textContent = parsed.roleNames.length.toLocaleString();
    $('#project-import-summary').classList.toggle('needs-review', !!parsed.pending);
    $('#project-import-summary').textContent = '识别到 ' + parsed.chapters.length + ' 个章节、' + parsed.count + ' 条台词、' + parsed.roleNames.length + ' 个角色。' + (parsed.pending ? ' ' + parsed.pending + ' 条待分配角色，请在下方核对。' : ' 0 条待分配。请核对识别结果，确认后即可导入。') + (parsed.customCues ? ' ' + parsed.customCues + ' 处自定义语气会保存为表演要求，请试听确认。' : '');
  }
  function importDialog() {
    parsed = null; importFilename = ''; importPage = 1; $('#project-import-text').value = ''; $('#project-import-filename').textContent = '';
    $('#project-import-script-mode').value = project.roles.length > 1 ? 'dialogue' : 'narration';
    $('#project-import-error').textContent = ''; setImportStep('source');
    $('#project-import-mode option[value="append"]').disabled = !chapterId;
    $('#project-import-mode option[value="replace"]').disabled = !chapterId;
    const chapter = project.chapters.find(item => item.id === chapterId);
    $('#project-import-mode option[value="append"]').textContent = chapter ? '追加到「' + chapter.name + '」' : '追加到当前章节（请先选择章节）';
    $('#project-import-mode option[value="replace"]').textContent = chapter ? '替换「' + chapter.name + '」的全部台词（可以撤销）' : '替换当前章节（请先选择章节）';
    $('#project-import-mode').value = 'chapters'; $('#project-import-splitting').value = 'paragraph'; syncImportSource();
    $('#project-import-dialog').showModal(); $('#project-import-text').focus({ preventScroll: true }); window.CustomSelects?.sync();
  }
  function previewImport() {
    try {
      parsed = M.parse($('#project-import-text').value, importFilename, hooks.emotions, window.parseScript, { splitSentences: $('#project-import-splitting').value === 'sentence', scriptMode: $('#project-import-script-mode').value });
      importPage = 1; $('#project-import-filter').value = 'all';
      $('#project-import-file-info').textContent = $('#project-import-filename').textContent; $('#project-import-file-info').hidden = !$('#project-import-file-info').textContent;
      if (parsed.pending && !parsed.roleNames.includes('旁白')) parsed.roleNames.unshift('旁白');
      $('#project-import-error').textContent = ''; setImportStep('preview'); updateImportSummary();
      const list = $('#project-import-mappings'); list.replaceChildren();
      for (const [index, name] of parsed.roleNames.entries()) {
        const row = node('div', 'project-import-map-row'); row.dataset.roleName = name;
        const mapping = node('select'); mapping.setAttribute('aria-label', name + ' 对应的项目角色'); option(mapping, '', '新增角色：' + name);
        project.roles.forEach(role => option(mapping, role.id, role.name)); mapping.value = M.roleFor(project, name)?.id || (name === '旁白' && project.roles.length === 1 ? project.roles[0].id : '');
        const voice = node('select'); voice.setAttribute('aria-label', name + ' 的配音声音'); voice.dataset.selectKind = 'voice'; voiceChoices(voice);
        const sync = () => { const existing = project.roles.find(role => role.id === mapping.value); voice.disabled = !!existing; if (existing) voice.value = existing.voiceKey; window.CustomSelects?.sync(); };
        const profile = node('div', 'import-role-profile'); profile.dataset.color = index % 5;
        const avatar = node('span', 'import-role-avatar', Array.from(name)[0]); avatar.setAttribute('aria-hidden', 'true');
        profile.append(avatar, node('strong', '', name));
        mapping.onchange = sync; sync(); row.append(profile, mapping, voice); list.append(row);
      }
      renderImportSample();
      window.CustomSelects?.sync(); $('#project-import-dialog').scrollTop = 0; $('#project-import-edit').focus({ preventScroll: true });
    } catch (error) { parsed = null; setImportStep('source'); $('#project-import-error').textContent = cleanError(error); $('#project-import-error').scrollIntoView({ block: 'nearest' }); }
  }
  function renderImportSample() {
    if (!parsed) return;
    const all = parsed.chapters.flatMap(chapter => chapter.lines.map(line => ({ line, chapter: chapter.name })));
    const rows = all.map((row, index) => ({ ...row, index })).filter(({ line }) => $('#project-import-filter').value !== 'review' || !line.role || line.role !== '旁白' && !M.roleFor(project, line.role));
    const pages = Math.max(1, Math.ceil(rows.length / 20)); importPage = Math.min(importPage, pages);
    const sample = $('#project-import-sample'); sample.replaceChildren();
    rows.slice((importPage - 1) * 20, importPage * 20).forEach(({ line, chapter, index }) => {
      const item = node('div', 'import-preview-row'), select = node('select'); select.setAttribute('aria-label', '第 ' + (index + 1) + ' 条的角色');
      option(select, '', '待分配角色'); parsed.roleNames.forEach(name => option(select, name, name)); select.value = line.role;
      select.onchange = () => { line.role = select.value; parsed.pending = all.filter(row => !row.line.role).length; updateImportSummary(); renderImportSample(); };
      item.append(node('small', '', '第 ' + (index + 1) + ' 条 · ' + chapter), select, node('p', '', line.text)); sample.append(item);
    });
    if (!rows.length) sample.append(node('p', '', '没有待核对的台词，可切换到全部台词。'));
    $('#project-import-page').textContent = '第 ' + importPage + ' / ' + pages + ' 页 · ' + rows.length + ' 条';
    $('#project-import-prev').disabled = importPage === 1; $('#project-import-next').disabled = importPage === pages;
    window.CustomSelects?.sync();
  }
  async function produce(entries, force = false, managedOptions = {}) {
    if (submitting) return;
    const valid = entries.filter(entry => entry?.line.text.trim() && entry.status !== 'pending' && (force || entry.status !== 'complete'));
    if (!valid.length) return hooks.toast('这个范围已完成，或正在处理中。');
    if (valid.some(needsSetup)) { fixRoles(valid); return hooks.toast('请先配好角色；人物声音需要填写声线描述，确定并试听后保存。', true); }
    if (valid.some(entry => !hooks.ready(entry.options))) { preparePackages(); return hooks.toast('请先准备这些角色需要的声音包，准备后可返回继续。'); }
    const invalid = valid.find(entry => entry.line.filename && !/^[\p{L}\p{N}_-]{1,80}$/u.test(entry.line.filename));
    if (invalid) return hooks.toast('文件名只可使用中文、字母、数字、下划线和短横线，请检查第 ' + (invalid.li + 1) + ' 句。', true);
    // Freeze all submission inputs before the first await; the editor remains editable.
    const sourceProject = project, previousAttempts = valid.map(entry => structuredClone(entry.line.generationAttempt));
    const snapshot = structuredClone(valid), target = { ...structuredClone(managedOptions), project: project.name, projectId: project.id };
    const chunkPlans = snapshot.map(entry => M.splitText(entry.line.text));
    for (const [index, entry] of snapshot.entries()) {
      entry.options.text = entry.line.text;
      const version = M.fingerprint(entry.options), previous = entry.line.generationAttempt;
      const chunks = chunkPlans[index];
      // Part numbers alone are not a split plan. A pre-upgrade partial take may
      // have cut a word or Unicode character at a different position. Only
      // resume saved parts whose actual text and count match the current plan.
      const compatible = entry.clips.every(clip => {
        const index = clip.options.partIndex || 0;
        return Number.isInteger(index) && index >= 0 && index < chunks.length &&
          (clip.options.partCount || 1) === chunks.length && (clip.text ?? clip.options.text) === chunks[index];
      });
      const reusable = !force && compatible && (previous?.version === version || entry.clips.length > 0);
      // Adopt a pre-upgrade or recovered take without changing its historical audio metadata.
      const attempt = reusable && previous?.version === version ? previous
        : { id: reusable ? entry.clips[0].options.lineTakeId || M.LEGACY_TAKE_ID : crypto.randomUUID(), version };
      entry.line.generationAttempt = attempt;
      entry.clips = reusable ? entry.clips.filter(clip => (clip.options.lineTakeId || M.LEGACY_TAKE_ID) === attempt.id) : [];
      valid[index].line.generationAttempt = structuredClone(attempt);
    }
    markChanged(); submitting = true; submittingLineIds = new Set(valid.map(entry => entry.line.id)); refreshMedia();
    let saved = false, submitted = false;
    try {
      await save(); saved = true;
      const rows = snapshot.flatMap((entry, index) => {
        const chunks = chunkPlans[index], saved = new Set(entry.clips.map(clip => clip.options.partIndex || 0));
        return chunks.map((text, index) => ({ ...entry.options, text, lineVersion: entry.line.generationAttempt.version, lineTakeId: entry.line.generationAttempt.id, partIndex: index, partCount: chunks.length,
          filename: chunks.length > 1 ? entry.options.filename.slice(0, 75) + '-' + String(index + 1).padStart(3, '0') : entry.options.filename })).filter(row => !saved.has(row.partIndex));
      });
      const result = await hooks.submit({ ...target, projectBatch: true, rows });
      submitted = true;
      derived = null; refreshMedia(); hooks.toast(managedOptions.managed ? managedOptions.scheduledAt ? '已预约托管。请保持软件运行，到点会自动开始。' : '已开始托管，逐段保存，完成后会提醒你。' : '已提交 ' + valid.length + ' 句，自动分批在后台生成，可以继续编辑。');
      return result;
    } catch (error) {
      if (!submitted) {
        const currentLines = new Map(M.entries(sourceProject).map(entry => [entry.line.id, entry.line]));
        for (const [index, entry] of snapshot.entries()) {
          const line = currentLines.get(entry.line.id);
          if (line?.generationAttempt?.id !== entry.line.generationAttempt.id) continue;
          if (previousAttempts[index]) line.generationAttempt = previousAttempts[index];
          else delete line.generationAttempt;
        }
        if (project?.id === target.projectId) { markChanged(); if (saved) await save().catch(() => {}); }
        else if (saved) await hooks.api('project-save', structuredClone(sourceProject)).catch(() => {});
      }
      throw error;
    } finally { submitting = false; submittingLineIds.clear(); refreshMedia(); }
  }
  function stopAudio() {
    mixer.stop();
    audioFeedback?.(); audioFeedback = null;
    playbackToken++; listening = false; playbackKey = ''; activeLineId = ''; playbackPhase = 'idle'; window.SoundFeedback?.set($('#project-role-prepare-voice'));
    if (!preparingRoleVoice) $('#project-role-prepare-label').textContent = '确定并试听声音';
    if (audio) { audio.pause(); audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    syncPlayback();
  }
  function syncPlayback() {
    labelControl($('#project-listen'), listening ? '停止连听' : '顺序连听', listening ? 'square' : 'play');
    $('#project-listen').setAttribute('aria-pressed', String(listening));
    window.SoundFeedback?.set($('#project-listen'), playbackPhase);
    document.querySelectorAll('.project-line-row').forEach(row => {
      const playing = listening && row.dataset.lineId === activeLineId; row.classList.toggle('is-playing', playing);
      const button = row.querySelector('.project-line-listen');
      labelControl(button, playing ? '停止试听' : '试听', playing ? 'square' : 'play', true); button.setAttribute('aria-pressed', String(playing));
      window.SoundFeedback?.set(button, playing ? playbackPhase : 'idle');
    });
  }
  async function play(clips) {
    const key = clips.map(clip => clip.id).join(',');
    if (listening && key === playbackKey) { stopAudio(); return; }
    if (!clips.length) return;
    stopAudio(); hooks.stopOtherAudio(); window.SoundFeedback?.stop(); listening = true; playbackKey = key; playbackPhase = 'loading'; const token = playbackToken;
    $('#project-listen').disabled = false;
    try {
      for (const clip of clips) {
        playbackPhase = 'loading'; activeLineId = contexts().find(entry => entry.clips.some(item => item.id === clip.id))?.line.id || ''; syncPlayback();
        const data = await hooks.api('audio', { id: clip.id }); if (token !== playbackToken) return;
        audioUrl = URL.createObjectURL(new Blob([data], { type: 'audio/wav' })); audio = new Audio(audioUrl);
        audioFeedback?.(); audioFeedback = window.SoundFeedback?.bind(audio, [], { initial: 'loading', stop: stopAudio, onState: phase => { if (token === playbackToken) { playbackPhase = phase; syncPlayback(); } } });
        await new Promise((resolve, reject) => {
          audio.onended = resolve; audio.onpause = resolve; audio.onerror = () => reject(new Error('音频暂时无法播放，请重试'));
          audio.play().catch(reject);
        });
        if (token !== playbackToken) return;
        URL.revokeObjectURL(audioUrl); audioUrl = null; audio = null;
      }
    } finally { if (token === playbackToken) { stopAudio(); renderProduction(); } }
  }
  async function listen(id) {
    if (id && project?.id !== id) await open(id);
    if (!project) return;
    if (id && ($('#project-detail').hidden || $('#view-projects').classList.contains('hidden'))) {
      $('#project-library').hidden = true; $('#project-detail').hidden = false;
      hooks.navigate();
    }
    return play(scoped().flatMap(entry => entry.clips));
  }
  async function convert(legacy) {
    await save();
    const value = M.create(legacy.name || '我的多角色配音'), byVoice = new Map(); value.roles = [];
    for (const row of legacy.rows) {
      if (!byVoice.has(row.voiceKey)) {
        const voice = hooks.voices().find(voice => voice.key === row.voiceKey);
        const { text, filename, project: projectName, ...options } = row.options || {};
        if (row.instruction) options.instruction = '';
        let name = row.roleName || voice?.name || '角色' + (value.roles.length + 1);
        if (value.roles.some(role => role.name === name)) name = name.slice(0, 26) + ' ' + (value.roles.length + 1);
        const role = { id: crypto.randomUUID(), name, aliases: [], voiceKey: row.voiceKey, emotion: 'natural', pace: options.pace || 'normal', options };
        byVoice.set(row.voiceKey, role); value.roles.push(role);
      }
      value.chapters[0].lines.push({ ...M.line(row.text, byVoice.get(row.voiceKey).id), emotion: row.emotion || '', pace: row.pace || '', instruction: row.instruction || '', filename: row.filename || '' });
    }
    if (!value.roles.length) value.roles = M.create().roles;
    await hooks.api('project-save', value); await open(value.id, value);
    hooks.toast('已转为配音项目，原来的逐句文案也已保留。');
  }
  async function startScene(template, catalog, name = template.name) {
    if (creating) throw new Error('正在创建项目，请稍候再试。');
    creating = true;
    try {
      await save();
      const value = M.fromTemplate(template, catalog, name);
      const result = await hooks.api('project-save', value);
      if (!result?.saved) throw new Error('场景项目保存失败，请重试。');
      if (result.updatedAt) value.updatedAt = result.updatedAt;
      await open(value.id, value);
      return value;
    } finally { creating = false; }
  }
  // Static controls are bound once. Rebuilt rows retain only project data.
  $('#project-new').onclick = newDialog; $('#project-back').onclick = guard(library);
  $('#project-search').oninput = () => { libraryPage = 1; renderLibrary(); };
  for (const id of ['project-library-sort', 'project-library-page-size']) $('#' + id).onchange = () => { libraryPage = 1; renderLibrary(); };
  document.querySelectorAll('[data-project-layout]').forEach(control => { control.onclick = () => {
    libraryLayout = control.dataset.projectLayout;
    document.querySelectorAll('[data-project-layout]').forEach(item => item.setAttribute('aria-pressed', String(item === control)));
    renderLibrary();
  }; });
  document.querySelectorAll('[data-project-step]').forEach(item => { item.onclick = guard(() => visitStep(item.dataset.projectStep)); });
  $('#project-fix-roles').onclick = () => fixRoles();
  function preparePackages() { hooks.downloads(scoped().map(entry => entry.options).filter(Boolean), null, project.name); }
  $('#project-prepare-voices').onclick = preparePackages;
  $('#project-target-seconds').oninput = () => {
    if (!$('#project-target-seconds').checkValidity()) return;
    project.targetSeconds = Number($('#project-target-seconds').value) || 0; markChanged(); renderProduction();
  };
  $('#project-options-open').onclick = () => { renderProduction(); $('#project-options-dialog').showModal(); $('#project-options-close').focus(); };
  $('#project-options-close').onclick = $('#project-options-done').onclick = () => $('#project-options-dialog').close();
  $('#project-options-dialog').addEventListener('close', () => $('#project-options-open').focus({ preventScroll: true }));
  document.querySelectorAll('[data-project-target]').forEach(button => { button.onclick = () => { $('#project-target-seconds').value = button.dataset.projectTarget; $('#project-target-seconds').dispatchEvent(new Event('input')); }; });
  $('#project-filter-toggle').onclick = () => { const expanded = $('#project-extra-filters').hidden; $('#project-extra-filters').hidden = !expanded; $('#project-filter-toggle').setAttribute('aria-expanded', String(expanded)); };
  document.querySelectorAll('[data-line-status]').forEach(button => { button.onclick = () => { $('#project-filter-status').value = button.dataset.lineStatus; page = 1; selected.clear(); $('#project-generation-scope').value = 'filtered'; renderLines(); }; });
  $('#project-reveal-work').onclick = () => { chapterId = ''; resetFilters(); $('#project-generation-scope').value = 'all'; render(); jumpTo('#project-lines'); };
  $('#project-add-line-top').onclick = () => $('#project-add-line').click();
  document.addEventListener('click', event => document.querySelectorAll('.project-line-more[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; }));
  $('#project-lines').addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.project-line-more[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); }); });
  $('#project-new-form').onsubmit = guard(async event => {
    event.preventDefault(); const name = $('#project-new-name').value.trim(); if (!name || creating) return;
    creating = true; $('#project-new-form .primary').disabled = true;
    try {
      await save(); const value = M.create(name, hooks.defaultVoice()); await hooks.api('project-save', value); libraryPage = 1;
      $('#project-new-dialog').close(); await open(value.id, value);
    } finally { creating = false; $('#project-new-form .primary').disabled = false; }
  });
  editInput($('#project-title'), value => { project.name = value.trim() || '未命名配音项目'; });
  $('#project-title').onblur = () => { if (project) $('#project-title').value = project.name; };
  editInput($('#project-chapter-title'), value => { const chapter = project.chapters.find(chapter => chapter.id === chapterId); if (chapter) chapter.name = value.trim() || '未命名章节'; });
  $('#project-chapter-title').onblur = () => { if (project) renderChapters(); };
  $('#project-save-retry').onclick = guard(save);
  $('#project-undo').onclick = () => { if (!undo.length) return; project = undo.pop(); selected.clear(); if (!project.chapters.some(chapter => chapter.id === chapterId)) chapterId = project.chapters[0].id; markChanged(); render(); hooks.toast('已撤销上一步操作'); };
  $('#project-add-chapter').onclick = guard(() => mutate(() => {
    const chapter = { id: crypto.randomUUID(), name: '第' + (project.chapters.length + 1) + '章', lines: [] }; project.chapters.push(chapter); chapterId = chapter.id; page = 1; selected.clear(); $('#project-generation-scope').value = 'filtered';
  }));
  $('#project-remove-chapter').onclick = guard(() => {
    const chapter = project.chapters.find(chapter => chapter.id === chapterId); if (!chapter) return;
    confirm('删除这个章节？', '「' + chapter.name + '」内的 ' + chapter.lines.length + ' 条台词将一并移除，可撤销。已生成音频会保留。', () => mutate(() => {
      project.chapters = project.chapters.filter(item => item.id !== chapter.id);
      if (!project.chapters.length) project.chapters = [{ id: crypto.randomUUID(), name: '第1章', lines: [] }];
      chapterId = project.chapters[0].id; page = 1; selected.clear();
    }));
  });
  $('#project-add-role').onclick = () => roleDialog(null);
  $('#project-role-close').onclick = () => $('#project-role-dialog').close();
  $('#project-role-voice').onchange = () => {
    roleEngineOverride = '';
    $('#project-role-error').textContent = '';
    const voice = hooks.resolveVoice($('#project-role-voice').value);
    $('#project-role-description').value = voice?.voiceDescription || ''; $('#project-role-instruction').value = voice?.instruction || '';
    rolePerformance();
  };
  $('#project-role-installed').onclick = () => {
    const fallback = hooks.installedVoice?.(); if (!fallback) return;
    $('#project-role-voice').value = fallback.key; $('#project-role-voice').onchange();
    roleEngineOverride = fallback.engine; rolePerformance();
    $('#project-role-voice-note').textContent = '已改用现成音色，无需定声。试听满意后保存角色即可继续。';
  };
  $('#project-role-lock-voice').onchange = rolePerformance;
  $('#project-role-reference-style').onchange = rolePerformance;
  $('#project-role-reset-voice').onclick = () => {
    editingVoiceRevision = crypto.randomUUID();
    preparedRoleVoice = null; stopAudio();
    updateRoleAnchorState();
    $('#project-role-voice-note').textContent = '请点击“确定并试听声音”生成新的角色声音，试听满意后保存角色。';
  };
  $('#project-role-prepare-voice').onclick = async () => { if ($('#project-role-prepare-voice').dataset.soundState === 'playing') { stopAudio(); return; } try { await prepareRoleVoice(); } catch (error) { $('#project-role-error').textContent = cleanError(error); } };
  $('#project-role-dialog').addEventListener('close', () => { stopAudio(); hooks.stopOtherAudio(); });
  $('#project-role-preview').onclick = guard(() => hooks.preview($('#project-role-voice').value));
  for (const id of ['project-role-emotion', 'project-role-pace', 'project-role-description', 'project-role-instruction', 'project-role-intensity']) {
    $('#' + id).addEventListener('input', () => {
      $('#project-role-intensity-value').value = $('#project-role-intensity').value + '%'; updateRoleAnchorState();
    });
    $('#' + id).addEventListener('change', updateRoleAnchorState);
  }
  hooks.emotions.forEach(emotion => option($('#project-role-emotion'), emotion.id, emotion.name));
  option($('#project-bulk-emotion'), '', '不改语气'); option($('#project-bulk-emotion'), 'inherit', '跟随角色语气');
  hooks.emotions.forEach(emotion => option($('#project-bulk-emotion'), emotion.id, emotion.name));
  $('#project-role-form').onsubmit = async event => {
    event.preventDefault();
    try {
      const role = roleFromForm(), options = draftVoiceOptions(role);
      if (options?.mode === 'design' && options.lockVoice && options.voiceDescription?.trim()) {
        if (!preparedRoleVoice || preparedRoleVoice.signature !== M.voiceSettingsSignature(options)) throw new Error('请先点击“确定并试听声音”，试听满意后再保存角色。');
        role.options.voiceAnchorId = preparedRoleVoice.voiceAnchorId; role.options.voiceAnchorSignature = preparedRoleVoice.signature;
      }
      mutate(() => {
        const index = project.roles.findIndex(item => item.id === role.id);
        if (index >= 0) project.roles[index] = role; else project.roles.push(role);
        if (roleTarget) M.entries(project).find(entry => entry.line.id === roleTarget).line.roleId = role.id;
      });
      $('#project-role-dialog').close(); hooks.stopOtherAudio();
    } catch (error) { $('#project-role-error').textContent = cleanError(error); }
  };
  $('#project-role-delete').onclick = () => {
    const role = project.roles.find(role => role.id === editingRoleId);
    if (project.roles.length === 1) return hooks.toast('请至少保留一个角色。');
    confirm('删除角色「' + role.name + '」？', '它的台词会保留，并标为“待分配角色”，可以批量重新分配。', () => {
      mutate(() => { project.roles = project.roles.filter(item => item.id !== role.id); M.entries(project).forEach(entry => { if (entry.line.roleId === role.id) entry.line.roleId = ''; }); });
      $('#project-role-dialog').close();
    });
  };
  for (const id of ['project-line-search', 'project-filter-role', 'project-filter-status']) $('#' + id).addEventListener(id === 'project-line-search' ? 'input' : 'change', () => { page = 1; selected.clear(); $('#project-generation-scope').value = 'filtered'; renderLines(); });
  $('#project-filter-reset').onclick = () => { resetFilters(); $('#project-generation-scope').value = 'filtered'; renderLines(); };
  $('#project-previous').onclick = () => { page--; renderLines(); };
  $('#project-next').onclick = () => { page++; renderLines(); };
  $('#project-add-line').onclick = guard(() => {
    mutate(() => {
    const chapter = project.chapters.find(chapter => chapter.id === chapterId) || project.chapters[0];
    const roleId = $('#project-filter-role').value;
    chapter.lines.push(M.line('', project.roles.some(role => role.id === roleId) ? roleId : project.roles.length === 1 ? project.roles[0].id : '')); chapterId = chapter.id;
    resetFilters(); $('#project-generation-scope').value = 'filtered'; page = Math.ceil(chapter.lines.length / PAGE_SIZE);
    });
    $('#project-lines .project-line-row:last-child>textarea').focus();
  });
  $('#project-select-page').onchange = () => {
    const checked = $('#project-select-page').checked;
    filtered().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(entry => { if (checked) selected.add(entry.line.id); else selected.delete(entry.line.id); }); renderSelection(true); renderLines();
  };
  $('#project-select-filtered').onclick = () => { filtered().forEach(entry => selected.add(entry.line.id)); renderSelection(true); renderLines(); };
  $('#project-clear-selection').onclick = () => { selected.clear(); renderLines(); };
  $('#project-bulk-apply').onclick = guard(() => mutate(() => {
    const role = $('#project-bulk-role').value, emotion = $('#project-bulk-emotion').value, pace = $('#project-bulk-pace').value, destination = $('#project-bulk-chapter').value;
    const chosen = M.entries(project).filter(entry => selected.has(entry.line.id));
    let skippedExpression = false;
    for (const entry of chosen) {
      if (role) entry.line.roleId = role === '__unassigned' ? '' : role;
      const options = M.optionsFor(project, entry, hooks.resolveVoice);
      if (options?.mode === 'design' && options.lockVoice && (emotion || pace)) { skippedExpression = true; continue; }
      if (emotion) { entry.line.emotion = emotion === 'inherit' ? '' : emotion; if (emotion === 'inherit') entry.line.instruction = ''; }
      if (pace) entry.line.pace = pace === 'inherit' ? '' : pace;
    }
    if (skippedExpression) hooks.toast('固定人物声音的角色沿用定声样本的表达，逐句语气和节奏未改动。');
    if (destination) {
      project.chapters.forEach(chapter => { chapter.lines = chapter.lines.filter(line => !selected.has(line.id)); });
      project.chapters.find(chapter => chapter.id === destination).lines.push(...chosen.map(entry => entry.line));
    }
    hooks.toast('已更新 ' + chosen.length + ' 条台词。设置“跟随角色”可恢复角色默认表达。');
  }));
  $('#project-bulk-delete').onclick = () => confirm('删除选中的 ' + selected.size + ' 条台词？', '包含其他页选中的台词。删除后可撤销，已生成音频会保留。', () => mutate(() => {
    project.chapters.forEach(chapter => { chapter.lines = chapter.lines.filter(line => !selected.has(line.id)); }); selected.clear();
  }));
  $('#project-generation-scope').onchange = renderProduction; $('#project-generate').onclick = guard(() => produce(scoped()));
  $('#project-managed').onclick = () => { $('#project-options-dialog').close(); openManaged(); }; $('#project-managed-tasks').onclick = hooks.showTasks;
  $('#managed-scope').onchange = renderManaged;
  document.querySelectorAll('[name="managed-start"]').forEach(input => input.onchange = () => {
    const scheduled = document.querySelector('[name="managed-start"]:checked').value === 'scheduled';
    $('#managed-time-field').hidden = !scheduled; $('#managed-time').required = scheduled;
    $('#managed-submit').textContent = scheduled ? '预约托管' : '开始托管';
  });
  $('#managed-form').onsubmit = async event => {
    event.preventDefault(); if (submitting) return;
    const entries = renderManaged(); if ($('#managed-submit').disabled) return;
    const scheduledAt = document.querySelector('[name="managed-start"]:checked').value === 'scheduled' ? new Date($('#managed-time').value).getTime() : null;
    if (scheduledAt !== null && (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now() || scheduledAt > Date.now() + 30 * 86400000)) { $('#managed-error').textContent = '请选择未来 30 天内的开始时间。'; return; }
    $('#managed-submit').disabled = true;
    try {
      const result = await produce(entries, false, { managed: true, scheduledAt });
      if (result) $('#managed-dialog').close();
    } catch (error) { $('#managed-error').textContent = cleanError(error); }
    finally { $('#managed-submit').disabled = false; }
  };
  $('#project-quick-previous').onclick = () => { page--; renderLines(); };
  $('#project-quick-next').onclick = () => { page++; renderLines(); };
  $('#project-page-jump').onchange = () => { page = Number($('#project-page-jump').value); renderLines(); };
  const moveChapter = offset => mutate(() => { const index = project.chapters.findIndex(chapter => chapter.id === chapterId); [project.chapters[index], project.chapters[index + offset]] = [project.chapters[index + offset], project.chapters[index]]; });
  $('#project-chapter-up').onclick = guard(() => moveChapter(-1)); $('#project-chapter-down').onclick = guard(() => moveChapter(1));
  $('#project-listen').onclick = guard(() => listen());
  $('#project-export').onclick = guard(async () => {
    const items = M.exportItems(scoped());
    if (!items.length) return; const result = await hooks.export(items, $('#project-export-format').value);
    if (result?.saved) hooks.toast('已按章节和台词顺序打包 ' + result.count + ' 段音频。');
  });
  $('#project-delivery').onclick = openDelivery;
  $('#project-delivery-form').onsubmit = submitDelivery;
  $('#project-delivery-close').onclick = requestDeliveryClose;
  $('#project-delivery-dialog').addEventListener('cancel', event => { event.preventDefault(); requestDeliveryClose(); });
  $('#project-delivery-cancel').onclick = () => delivery.active() ? delivery.cancel() : closeDelivery();
  $('#project-delivery-keep').onclick = () => { $('#project-delivery-close-confirm').hidden = true; $('#project-delivery-cancel').focus(); };
  $('#project-delivery-stop-close').onclick = async () => { deliveryCloseAfterCancel = true; const result = await delivery.cancel(); if (result === false && delivery.active() && delivery.getState().phase !== 'cancelling') deliveryCloseAfterCancel = false; };
  for (const selector of ['#project-delivery-scope', '#project-delivery-completeness']) $(selector).onchange = () => {
    if (delivery.active()) return;
    $('#project-delivery-partial-confirm').checked = false; deliveryReviewKey = ''; delivery.reset(); renderDelivery();
  };
  $('#project-delivery-partial-confirm').onchange = renderDelivery;
  const saveDeliverySettings = () => {
    if (!project || !$('#project-delivery-pause').checkValidity()) return;
    project.deliverySettings = deliverySettings(); markChanged(); renderDelivery();
  };
  $('#project-delivery-pause').oninput = saveDeliverySettings;
  for (const id of ['project-delivery-trim', 'project-delivery-normalize', 'project-delivery-segments']) $('#' + id).onchange = saveDeliverySettings;
  $('#project-import').onclick = importDialog;
  $('#project-lines').addEventListener('focusout', () => queueMicrotask(refreshMedia));
  $('#project-import-edit').onclick = () => {
    parsed = null; setImportStep('source'); syncImportSource(); $('#project-import-text').focus({ preventScroll: true });
  };
  $('#project-import-text').oninput = () => { parsed = null; $('#project-import-error').textContent = ''; syncImportSource(); };
  $('#project-import-file').onclick = guard(async () => {
    const file = await hooks.api('import-script'); if (!file) return;
    importFilename = file.name; $('#project-import-text').value = file.text; $('#project-import-filename').textContent = file.name + (file.note ? ' · ' + file.note : ''); if (/\.(csv|tsv)$/i.test(file.name)) $('#project-import-script-mode').value = 'dialogue'; else if (/\.(docx|pptx)$/i.test(file.name)) $('#project-import-script-mode').value = 'narration'; syncImportSource(); previewImport();
  });
  $('#project-import-example').onclick = () => {
    $('#project-import-script-mode').value = 'dialogue';
    $('#project-import-filename').textContent = '故事示例.txt';
    importFilename = '.txt'; $('#project-import-text').value = '第1章 森林里的早晨\n旁白：小兔子推开窗，看见了明亮的太阳。\n小兔子（开心）：今天我们去探险吧！\n熊爷爷：好呀，记得带上地图。\n第2章 桥边的难题\n旁白：他们走到河边，发现小桥被雨水冲坏了。\n小兔子（担心）：这可怎么办？\n熊爷爷（温柔）：别着急，我们一起想办法。'; syncImportSource(); previewImport();
  };
  $('#project-import-preview').onclick = previewImport;
  $('#project-import-splitting').onchange = () => { if (parsed) previewImport(); };
  $('#project-import-script-mode').onchange = () => { syncImportSource(); if (parsed) previewImport(); };
  document.querySelectorAll('[name="project-import-kind"]').forEach(input => { input.onchange = () => {
    if (!input.checked) return;
    $('#project-import-script-mode').value = input.value; $('#project-import-script-mode').dispatchEvent(new Event('change', { bubbles: true }));
  }; });
  $('#project-import-filter').onchange = () => { importPage = 1; renderImportSample(); };
  $('#project-import-prev').onclick = () => { importPage--; renderImportSample(); };
  $('#project-import-next').onclick = () => { importPage++; renderImportSample(); };
  $('#project-import-apply').onclick = guard(() => {
    if (!parsed) return;
    if (!chapterId && $('#project-import-mode').value !== 'chapters') throw new Error('请先在项目中选择一个具体章节，再追加或替换台词。');
    const mappings = Object.create(null);
    $('#project-import-mappings').querySelectorAll('[data-role-name]').forEach(row => { const selects = row.querySelectorAll('select'); mappings[row.dataset.roleName] = { roleId: selects[0].value, voiceKey: selects[1].value }; });
    const value = M.importInto(project, parsed, mappings, $('#project-import-mode').value, chapterId), before = new Set(project.chapters.map(chapter => chapter.id));
    mutate(() => { project = value; chapterId = value.chapters.find(chapter => !before.has(chapter.id))?.id || chapterId || value.chapters[0].id; resetFilters(); $('#project-generation-scope').value = 'filtered'; });
    $('#project-import-dialog').close();
    hooks.toast('已导入 ' + parsed.count + ' 条台词。' + (contexts().some(entry => entry.line.text.trim() && needsSetup(entry)) ? '点击“去完善角色”，继续配好角色和声音。' : '角色声音已就绪，可以生成配音了。'));
    jumpTo('#project-next-action');
  });
  $('#project-confirm-apply').onclick = guard(async () => { const action = confirmAction; confirmAction = null; await action?.(); $('#project-confirm-dialog').close(); });
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $('#' + button.dataset.close).close());
  for (const id of ['project-role-dialog', 'project-import-dialog']) $('#' + id).addEventListener('close', hooks.stopOtherAudio);
  window.addEventListener('beforeunload', flush);
  return { library, open, openLineEditor, convert, startScene, refreshMedia, flush, stopAudio, save, listen, resourceLocation, restoreResourceLocation, deliveryProgress: delivery.progress };
};
