// Keep the computer awake while a managed job runs or waits for its start time.
// The display can sleep. Paused and finished jobs release the assertion.
function createSleepGuard(blocker) {
  let id = null;
  function stop() { if (id !== null) { blocker.stop(id); id = null; } }
  function update(snapshot) {
    const needed = snapshot.jobs.some(job => job.managed && ['queued', 'scheduled', 'running'].includes(job.status));
    if (needed && id === null) id = blocker.start('prevent-app-suspension');
    else if (!needed) stop();
  }
  return { update, stop };
}
module.exports = { createSleepGuard };
