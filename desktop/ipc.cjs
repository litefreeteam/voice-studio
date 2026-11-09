// Electron logs rejected invoke handlers to stderr before replying. A desktop
// may outlive its launcher's output pipes, so send application errors as data.
function studioReply(handler) {
  return async (...args) => {
    try { return { ok: true, result: await handler(...args) }; }
    catch (error) {
      return { ok: false, error: { message: String(error?.message || error),
        code: typeof error?.code === 'string' ? error.code : 'STUDIO_ERROR' } };
    }
  };
}

module.exports = { studioReply };
