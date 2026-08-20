/**
 * dsh-drop-to-path-electron — host half (no-op).
 *
 * The real work happens in the browser (client) half. A host entry is required
 * for the package to be a valid bundle ("host half exists so the package is a
 * valid bundle", same pattern as the bundled dsh-auto-compact plugin).
 */
export const name = 'dsh-drop-to-path-electron';
export const inject = [];
export function apply() {
  // no-op — everything is client-side.
}
