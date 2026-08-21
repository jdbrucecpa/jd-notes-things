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
 * The bundled-audio-service migration (main.js, one-time) intentionally
 * clears main's aiServicePath and sets aiServicePathMigratedToBundled=true so
 * the app switches to the built-in service. Without the `migrated` flag, an
 * empty main path always looked like the pre-2.0.3 "self-heal" case, so this
 * reconciler pushed the renderer's stale localStorage copy straight back into
 * main — silently undoing the migration on every Settings open. When
 * `migrated` is true, an empty main path is authoritative: clear the stale
 * renderer copy instead of pushing it.
 *
 * @param {string|undefined} mainPath - aiServicePath from main process settings
 * @param {string|undefined} rendererPath - aiServicePath from renderer localStorage
 * @param {boolean} [migrated] - true once main has run the one-time bundled migration
 * @returns {{action: 'push'|'pull'|'clear'|'none', path: string}}
 *   push - main has no path and no migration has run; write the renderer's path to main (self-heal)
 *   pull - main's path wins; update the renderer to match
 *   clear - main was migrated to bundled mode; wipe the stale renderer-only copy, do not push it back
 *   none - stores already agree (or neither has a value)
 */
export function reconcileAiServicePath(mainPath, rendererPath, migrated = false) {
  const main = (mainPath || '').trim();
  const renderer = (rendererPath || '').trim();

  if (main) {
    return renderer === main ? { action: 'none', path: main } : { action: 'pull', path: main };
  }
  if (renderer) {
    if (migrated) {
      return { action: 'clear', path: '' };
    }
    return { action: 'push', path: renderer };
  }
  return { action: 'none', path: '' };
}
