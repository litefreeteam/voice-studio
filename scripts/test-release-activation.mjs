// Release builds deliberately disable Playwright's main-process inspector.
// Validate the actual sealed binaries and offline activation through the CLI;
// test-activation.mjs continues to cover renderer interactions in dev fixtures.
await import('./test-release-security.mjs');
