// Generation has no reliable token-level percentage. Count only saved clips.
(function (root) {
  function create(data, now = Date.now()) {
    const rows = Array.isArray(data.rows) ? data.rows.filter(row => row.text?.trim())
      : (data.batch ? String(data.text || '').split('\n').filter(text => text.trim()) : [String(data.text || '')]).map(text => ({ text, voiceName: data.voiceName }));
    return { rows, total: rows.length, characters: rows.reduce((sum, row) => sum + row.text.trim().length, 0),
      started: now, ended: null, stage: 'preparing', current: 1, completed: 0, ids: [], running: true, stopping: false, hasGenerated: false, error: '' };
  }
  function advance(task, event) {
    if (!task?.running) return;
    if (event.stage === 'clip' && event.item?.id && !task.ids.includes(event.item.id)) {
      task.ids.push(event.item.id); task.completed = Math.min(task.total, task.ids.length);
    }
    if (task.stopping) return;
    if (['loading', 'generating', 'encoding'].includes(event.stage)) {
      task.stage = event.stage;
      if (Number.isInteger(event.current)) task.current = Math.max(1, Math.min(task.total, event.current));
      if (event.stage !== 'loading') task.hasGenerated = true;
    }
    if (event.stage === 'clip') task.stage = task.completed === task.total ? 'finishing' : 'between';
  }
  function finish(task, outcome, error = '', now = Date.now()) {
    if (!task) return;
    task.running = false; task.ended = now; task.stage = outcome; task.error = error;
  }
  function view(task, now = Date.now()) {
    const seconds = Math.max(0, Math.floor(((task.ended ?? now) - task.started) / 1000));
    const elapsed = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
    const titles = {
      queued: '已加入后台，等待配音', scheduled: '已预约托管 · ' + new Date(task.scheduledAt).toLocaleString('zh-CN') + ' 开始', paused: '托管已暂停，可继续生成', retrying: '当前段正在自动重试（' + task.retryAttempt + ' / 2）', partial: '托管已结束，有段落待补做', interrupted: '上次配音已中断，可继续处理', preparing: '正在准备这次配音', loading: '正在唤醒你的声音',
      generating: task.total > 1 ? `正在生成第 ${task.current} / ${task.total} 段` : '正在把文字变成声音',
      encoding: task.total > 1 ? `正在保存第 ${task.current} / ${task.total} 段` : '声音已生成，正在保存',
      between: '这一段好了，继续下一段', finishing: '正在整理你的作品',
      complete: '配音完成，听听效果吧', cancelled: '已停止生成', failed: '这次配音没有完成', stopping: '正在停止生成'
    };
    let note = task.stage === 'loading' ? '第一次使用或切换声音时，准备时间会稍长一些。'
      : task.stage === 'encoding' || task.stage === 'finishing' ? '正在保存音频，完成后就能试听和导出。'
      : seconds >= 90 ? '这段文字仍在处理中。长文和细腻的声音需要更多时间，你可以随时停止。'
      : task.characters >= 200 ? '文字较长，会需要多一点时间。完成的段落会陆续出现在作品区。'
      : '声音正在本机生成，完成后就能试听。';
    if (task.stopping && task.running) note = '正在结束当前处理，已完成的配音会保留。';
    if (task.stage === 'complete') note = `已保存 ${task.completed} 段配音，可以试听，或导出到电脑。`;
    if (task.stage === 'cancelled') note = task.completed ? `已完成的 ${task.completed} 段配音已保留，可以继续试听和保存。` : '文案和声音设置都已保留，准备好后可以重新生成。';
    if (task.stage === 'failed') note = `${task.error || '请稍后重试。'}${task.completed ? ` 已完成的 ${task.completed} 段配音已保留。` : ''}`;
    if (task.stage === 'queued') note = '轮到这份文案时会自动开始，你可以继续创作。';
    if (task.stage === 'interrupted') note = task.error || '已完成的段落已保留，可以继续剩余文案。';
    if (task.stage === 'scheduled') note = '请保持软件运行、接通电源，到点后自动按顺序开始。';
    if (task.stage === 'paused') note = '已完成的音频已保存，点击继续生成可从剩余段落接着做。';
    if (task.stage === 'retrying') note = '这一段暂未成功，稍后自动重试；仍失败会记录并继续处理后文。';
    if (task.stage === 'partial') note = task.error;
    return { title: titles[task.stopping && task.running ? 'stopping' : task.stage], note, elapsed,
      count: `已完成 ${task.completed} / ${task.total} 段`, fraction: task.total ? task.completed / task.total : 0,
      indeterminate: task.running && task.total === 1 && task.completed === 0,
      voice: task.rows[task.current - 1]?.voiceName || '你选择的声音',
      text: task.rows[task.current - 1]?.text || '' };
  }
  const progress = { create, advance, finish, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = progress;
  else root.GenerationProgress = progress;
})(typeof globalThis !== 'undefined' ? globalThis : this);
