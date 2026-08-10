/**
 * Reconcile the JD Audio Service path between the main process's
 * app-settings.json (what aiServiceManager.ensureRunning() reads) and the
 * renderer's localStorage settings (what the Settings input displays).
 *
 * Pre-2.0.3 installs have the path baked into renderer localStorage (from the
 * old hardcoded default) but never forwarded it to the main process — the
 * input's change event that does the forwarding never fires for a value the
 * user doesn't retype. Main is the source of truth once it has a value.
 *
 * @param {string|undefined} mainPath - aiServicePath from main process settings
 * @param {string|undefined} rendererPath - aiServicePath from renderer localStorage
 * @returns {{action: 'push'|'pull'|'none', path: string}}
 *   push - main has no path; write the renderer's path to main (self-heal)
 *   pull - main's path wins; update the renderer to match
 *   none - stores already agree (or neither has a value)
 */
export function reconcileAiServicePath(mainPath, rendererPath) {
  const main = (mainPath || '').trim();
  const renderer = (rendererPath || '').trim();

  if (main) {
    return renderer === main ? { action: 'none', path: main } : { action: 'pull', path: main };
  }
  if (renderer) {
    return { action: 'push', path: renderer };
  }
  return { action: 'none', path: '' };
}
