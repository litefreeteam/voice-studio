const sources = require('../shared/download-sources.json');

function pythonArchive(profile) {
  const target = sources.pythonTargets[profile?.id];
  if (!target) throw new Error('当前平台暂无适用的声悦定制资源');
  return `${sources.pythonBuild}/cpython-${sources.pythonVersion}%2B${sources.pythonBuild}-${target}-install_only_stripped.tar.gz`;
}

function modelURL(source, repo, pinned, filename) {
  const file = pinned.files[filename];
  if (source.id === 'modelscope') return `${source.url}/api/v1/models/${repo}/repo?` + new URLSearchParams({ Revision: file.modelscopeRevision, FilePath: filename });
  return `${source.url}/${repo}/resolve/${pinned.revision}/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

// Run each index separately: a missing wheel or failed connection on one index
// must not prevent trying the next one, or change the pinned dependency versions.
async function withDownloadSources(stage, run, { progress = () => {}, cancelled = () => false } = {}) {
  let lastError;
  for (const [index, source] of sources[stage].entries()) {
    if (cancelled()) throw new Error('操作已取消，已下载的文件会保留');
    progress({ stage: stage === 'python' ? 'runtime' : 'dependencies', source: source.id,
      message: `${index ? '正在重新连接' : '正在连接'}声悦定制资源，已下载的内容会继续使用…` });
    try {
      await run(source);
      return source.id;
    } catch (error) {
      if (cancelled() || ['EACCES', 'ENOSPC', 'EROFS', 'ENOENT', 'CANCELLED', 'INSTALL_RESOURCE_MISSING'].includes(error.code) ||
          /no space left|not enough (?:space|disk)|disk (?:is )?full|permission denied|access (?:is )?denied|read-only file system/i.test(error.detail || '')) throw error;
      lastError = error;
    }
  }
  throw Object.assign(new Error('声悦定制资源准备失败，详细原因已写入诊断日志；已下载的内容会保留', { cause: lastError }),
    { code: 'RESOURCE_PREPARATION_FAILED' });
}

module.exports = { sources, pythonArchive, modelURL, withDownloadSources };
