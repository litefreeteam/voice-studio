/* First launch checks configuration before offering an explicit model download. */
window.createFirstRunGuide = ({ api, prepare, cancel, refresh, useInstalled }) => {
  const dialog = document.createElement('dialog');
  dialog.id = 'first-run-dialog'; dialog.className = 'preflight-dialog first-run-dialog';
  dialog.setAttribute('aria-labelledby', 'first-run-title');
  dialog.innerHTML = `<div class="preflight-heading"><div><span class="activation-tag">免费版 · 首次准备</span><h2 id="first-run-title">检查电脑，准备第一段好声音</h2><p>先检查系统、内存与磁盘，再联网下载模型。完成后可离线创作。</p></div></div>
    <div class="preflight-body"><label for="first-run-package">选择首次使用的功能</label><select id="first-run-package"><option value="standard">生动配音 · 至少 16 GB 内存</option><option value="light">轻量配音 · 至少 8 GB 内存</option><option value="all">全部基础功能 · 含人物创作与声音克隆</option></select>
    <p class="microcopy">以后可在设置中补齐其他声音功能。独立的情绪克隆资源可按需另行下载。</p>
    <div class="preflight-storage"><span>模型保存位置</span><span id="first-run-location"></span><button id="first-run-change" class="text-button">更换</button></div>
    <ul id="first-run-checks" class="preflight-checks"></ul><p id="first-run-space"></p>
    <p id="first-run-status" role="status" aria-live="polite"></p><progress id="first-run-progress" aria-label="模型下载进度" hidden></progress></div>
    <div class="preflight-footer"><button id="first-run-later" class="button">稍后下载，先看看</button><button id="first-run-download" class="primary" disabled>正在检查配置…</button><button id="first-run-pause" class="button" hidden>暂停下载</button></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#first-run-' + id);
  let report, checking = false, downloading = false, checkId = 0, failed = false;
  const packages = () => $('package').value === 'all' ? ['light', 'standard', 'character', 'reference'] : [$('package').value];
  function controls() {
    $('package').disabled = checking || downloading;
    $('change').disabled = checking || downloading;
    $('download').disabled = checking || downloading || (!failed && (!report || report.blocked));
    $('download').textContent = checking ? '正在检查配置…' : downloading ? '正在下载并安装…' : failed ? '重新检查配置' : '下载模型并开始使用';
    $('later').disabled = downloading;
    $('pause').hidden = !downloading;
  }
  function render(value) {
    report = value; $('location').textContent = value.assetDir;
    $('space').textContent = `当前选择建议预留 ${value.requiredDiskGB} GB，以实际下载和本机检测为准。`;
    $('checks').replaceChildren(...value.checks.map(check => {
      const li = document.createElement('li'); li.dataset.state = check.state;
      li.textContent = check.message; return li;
    }));
    $('status').textContent = value.blocked ? '请先处理未通过的配置项目，或切换为轻量配音后重新检查。' : '配置检查完成。点击下方按钮下载运行组件与所选模型，下载可能需要较长时间。';
  }
  async function check() {
    const id = ++checkId; checking = true; failed = false; controls();
    try { const value = await api('preflight', { packages: packages() }); if (id === checkId) render(value); }
    catch (error) { if (id === checkId) { report = null; failed = true; $('status').textContent = error.message; } }
    finally { if (id === checkId) { checking = false; controls(); } }
  }
  $('package').onchange = check;
  $('change').onclick = async () => {
    checking = true; controls();
    try { const value = await api('preflight-location', { packages: packages() }); if (value) render(value); }
    catch (error) { $('status').textContent = error.message; }
    finally { checking = false; controls(); }
  };
  $('later').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (downloading) event.preventDefault(); });
  $('download').onclick = async () => {
    if (failed) return check();
    await check(); if (!report || report.blocked) return;
    const selected = packages(); downloading = true; controls(); $('progress').hidden = false; $('progress').removeAttribute('value');
    try {
      const result = await prepare({ packages: selected });
      if (result) { if (selected.length === 1) useInstalled(selected[0]); await refresh(); dialog.close(); }
      else $('status').textContent = '下载未完成。已下载内容会保留，请重试；也可在设置中查看下载详情。';
    } catch (error) { $('status').textContent = error.message; }
    finally { downloading = false; $('progress').hidden = true; controls(); }
  };
  $('pause').onclick = async () => {
    $('pause').disabled = true; $('status').textContent = '正在暂停，已下载内容会保留…';
    try { await cancel(); } catch (error) { $('status').textContent = error.message; }
    finally { $('pause').disabled = false; }
  };
  return {
    async open(hardware) { $('package').value = hardware?.memoryGB < 16 ? 'light' : 'standard'; if (!dialog.open) dialog.showModal(); await check(); },
    progress(event) {
      if (!downloading || !event.message) return;
      $('status').textContent = event.message;
      const total = event.resourcesTotal || event.aggregateTotal || event.total;
      const current = event.resourcesTotal ? event.resourcesCurrent : event.aggregateTotal ? event.aggregateCurrent : event.current;
      if (Number.isFinite(total) && total > 0 && Number.isFinite(current)) { $('progress').max = total; $('progress').value = current; }
    }
  };
};
