(() => {
  const $ = id => document.getElementById(id), dialog = $('preflight-dialog');
  const names = { light: '轻量配音', standard: '生动配音与情绪', character: '人物与童声创作', reference: '声音克隆' };
  let report, busy = false, preparing = false, request = 0;
  let stopping = false, outcome = 'idle', runProgress = { completed: 0, package: null, phase: 'check' };
  let microphoneSession = 0, microphoneStream, microphoneContext, microphoneFrame, microphoneCancel, microphoneTesting = false;
  const packages = () => Object.keys(names);
  const invoke = (action, extra = {}) => window.studio.invoke(action, { packages: packages(), microphoneRequired: $('preflight-needs-microphone').checked, ...extra });
  function progressButton() {
    const button = $('preflight-prepare'), total = packages().length;
    button.dataset.progress = preparing ? 'running' : outcome;
    button.setAttribute('aria-busy', String(preparing));
    $('preflight-prepare-label').textContent = preparing ? stopping ? '正在停止检测…' : '正在检查配置与环境…' : outcome === 'complete' ? '检测完成，重新检查' : '检查配置与环境';
    $('preflight-button-progress').max = total;
    $('preflight-button-progress').value = runProgress.completed;
    $('preflight-button-count').textContent = `${runProgress.completed} / ${total}`;
    $('preflight-button-count').hidden = !preparing && outcome === 'idle';
    $('preflight-button-icon').className = `ui-icon icon-${outcome === 'complete' && !preparing ? 'check' : 'arrow-right'}`;
    $('preflight-options').querySelectorAll('[data-package]').forEach(tag => {
      const result = report?.results?.find(item => item.package === tag.dataset.package);
      tag.dataset.state = preparing ? packages().indexOf(tag.dataset.package) < runProgress.completed ? 'complete' : 'pending' : result ? result.passed ? 'complete' : 'fail' : 'pending';
    });
  }
  function stopMicrophone() {
    const cancel = microphoneCancel; microphoneCancel = null; cancel?.();
    ++microphoneSession; cancelAnimationFrame(microphoneFrame);
    microphoneStream?.getTracks().forEach(track => track.stop()); microphoneStream = null;
    microphoneContext?.close().catch(() => {}); microphoneContext = null;
  }
  function controls() {
    $('preflight-prepare').disabled = busy;
    progressButton();
    $('preflight-change-location').disabled = busy;
    $('preflight-needs-microphone').disabled = busy;
    $('preflight-microphone').disabled = busy;
    $('preflight-stop').hidden = !preparing;
    $('preflight-stop').disabled = stopping;
    $('preflight-copy').disabled = busy || !report;
    dialog.dataset.state = busy ? 'busy' : report?.ready ? 'ready' : 'pending';
  }
  function render(value) {
    report = value;
    $('preflight-location').textContent = value.assetDir;
    $('preflight-location').title = value.assetDir;
    $('preflight-space').textContent = `建议预留 ${value.requiredDiskGB} GB`;
    $('preflight-summary').textContent = value.summary;
    $('preflight-summary').dataset.state = value.ready ? 'pass' : value.blocked ? 'fail' : 'pending';
    $('gate-preflight-badge').textContent = value.ready ? '配置检查完成' : value.blocked ? '配置需调整' : '检查配置与环境';
    $('preflight-checks').replaceChildren();
    $('preflight-alerts').replaceChildren();
    const counts = value.checks.reduce((total, check) => { total[check.state] = (total[check.state] || 0) + 1; return total; }, {});
    $('preflight-check-count').textContent = Object.entries({ pass: '通过', fail: '未通过', warn: '注意', pending: '待准备' }).filter(([state]) => counts[state]).map(([state, label]) => `${counts[state]} 项${label}`).join(' · ');
    $('preflight-check-count').dataset.state = value.blocked ? 'fail' : counts.warn ? 'warn' : 'pass';
    for (const check of value.checks) {
      const li = document.createElement('li'); li.dataset.state = check.state;
      const mark = document.createElement('span'); mark.textContent = ({ pass: '通过', fail: '未通过', warn: '注意', pending: '待准备' })[check.state];
      li.append(mark, document.createTextNode(check.message));
      $(['fail', 'warn'].includes(check.state) ? 'preflight-alerts' : 'preflight-checks').append(li);
    }
    $('preflight-alerts').hidden = !$('preflight-alerts').childElementCount;
    $('preflight-results').replaceChildren();
    for (const result of value.results.filter(result => packages().includes(result.package))) {
      const row = document.createElement('div'), heading = document.createElement('strong'), detail = document.createElement('p');
      row.dataset.state = result.passed ? 'pass' : 'fail';
      heading.textContent = names[result.package];
      detail.textContent = (result.passed ? '配置符合要求' : '配置未通过，请查看检测项目') +
        (result.resourceReady ? ' · 已检测到本地资源' : ' · 声音资源使用时另行准备');
      row.append(heading, detail);
      $('preflight-results').append(row);
    }
    controls();
  }
  function showError(error) { $('preflight-progress').textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  async function check() {
    if (busy) return;
    busy = true; const current = ++request; controls();
    $('preflight-progress').textContent = '正在检查本机配置…';
    try { const value = await invoke('preflight'); if (current === request) { render(value); $('preflight-progress').textContent = ''; } }
    catch (error) { showError(error); }
    finally { busy = false; controls(); }
  }
  async function open() { if (!dialog.open) dialog.showModal(); await check(); }
  $('gate-preflight').onclick = open;
  $('preflight-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (preparing) invoke('preflight-cancel').catch(() => {}); if (microphoneTesting) { stopMicrophone(); invoke('preflight-microphone-result', { passed: false }).catch(() => {}); } });
  $('preflight-needs-microphone').onchange = () => check();
  $('preflight-microphone').onclick = async () => {
    if (busy) return;
    busy = microphoneTesting = true; controls(); stopMicrophone();
    const session = microphoneSession;
    $('preflight-microphone-state').textContent = '请允许麦克风权限，并说几句话…';
    let timer;
    try {
      await invoke('preflight-microphone-permission');
      const pending = navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
        if (session !== microphoneSession || !dialog.open) { stream.getTracks().forEach(track => track.stop()); throw new Error('检测已取消'); }
        return stream;
      });
      microphoneStream = await Promise.race([pending, new Promise((_, reject) => { microphoneCancel = () => reject(new Error('检测已取消')); timer = setTimeout(() => { reject(new Error('麦克风权限等待超时，请在系统设置中允许后重试')); stopMicrophone(); }, 25000); })]);
      microphoneCancel = null;
      clearTimeout(timer);
      microphoneContext = new AudioContext(); await microphoneContext.resume();
      const analyser = microphoneContext.createAnalyser(); analyser.fftSize = 1024;
      microphoneContext.createMediaStreamSource(microphoneStream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize), started = performance.now(); let heard = 0;
      const passed = await new Promise(resolve => {
        microphoneCancel = () => resolve(false);
        const sample = () => {
          if (session !== microphoneSession) return resolve(false);
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length);
          if (rms > 0.004) heard++;
          if (performance.now() - started >= 3000 && heard > 10) return resolve(true);
          if (performance.now() - started >= 10000) return resolve(false);
          microphoneFrame = requestAnimationFrame(sample);
        }; sample();
      });
      stopMicrophone();
      render(await invoke('preflight-microphone-result', { passed }));
      $('preflight-microphone-state').textContent = passed ? '已取得权限并检测到声音信号' : '未检测到足够声音，请检查输入设备、音量和系统权限后重试';
    } catch (error) {
      stopMicrophone(); await invoke('preflight-microphone-result', { passed: false }).then(render).catch(() => {});
      $('preflight-microphone-state').textContent = '麦克风检测未通过：' + window.VoiceRecording.errorMessage(error, window.studio.platform);
    } finally { clearTimeout(timer); busy = microphoneTesting = false; controls(); }
  };
  $('preflight-change-location').onclick = async () => {
    busy = true; controls();
    try { const value = await invoke('preflight-location'); if (value) render(value); } catch (error) { showError(error); }
    finally { busy = false; controls(); }
  };
  $('preflight-prepare').onclick = async () => {
    if (busy) return;
    stopping = false; outcome = 'idle';
    runProgress = { completed: 0, package: null, phase: 'check' };
    busy = preparing = true; ++request; controls();
    $('preflight-results').replaceChildren();
    $('preflight-progress').textContent = '正在检查配置、环境与资源连接…';
    try {
      render(await invoke('preflight-prepare', { network: true }));
      runProgress.completed = packages().length; outcome = 'complete';
      $('preflight-progress').textContent = '配置与环境检查完成。检测不会下载资源或生成配音。';
    } catch (error) {
      outcome = stopping || /取消|停止/.test(error.message) ? 'stopped' : 'error';
      try { render(await invoke('preflight')); } catch {}
      if (outcome === 'stopped') $('preflight-progress').textContent = '检测已停止。';
      else showError(error);
    } finally { busy = preparing = stopping = false; controls(); }
  };
  $('preflight-stop').onclick = () => {
    if (!preparing || stopping) return;
    stopping = true; controls();
    $('preflight-progress').textContent = '正在停止检测…';
    invoke('preflight-cancel').catch(error => { stopping = false; controls(); showError(error); });
  };
  $('preflight-copy').onclick = () => invoke('preflight-copy').then(() => { $('preflight-progress').textContent = '报告已复制，可留存或用于排查问题。'; }).catch(showError);
  window.studio.onProgress(event => {
    if (!preparing || stopping) return;
    if (Number.isInteger(event.completedPackages)) runProgress.completed = Math.max(runProgress.completed, Math.min(packages().length, event.completedPackages));
    if (packages().includes(event.package)) runProgress.package = event.package;
    progressButton();
    $('preflight-progress').textContent = (event.message || '正在检测…') + ' · 已完成 ' + runProgress.completed + ' / ' + packages().length + ' 项';
  });
  window.PurchasePreflight = { open };
})();
