/**
 * dsh-drop-to-path-electron — minimal DEMO client plugin.
 *
 * The whole point (for an official issue):
 *   - In a NORMAL BROWSER (Chrome/Edge) the web page is FORBIDDEN from seeing a
 *     dropped file's real absolute path. That is exactly why community plugins
 *     (e.g. dsh-drag-and-drop) must hunt for the file on disk — and why they
 *     feel slow ("很卡", especially without Everything/plocate/Spotlight).
 *   - Inside the DESKTOP / Electron shell, a PRELOAD-EXPOSED bridge
 *     (webUtils.getPathForFile via contextBridge) returns the REAL absolute
 *     path at drop time — instantly, no search.
 *   - IMPORTANT (verified): in a sandboxed Electron renderer, BOTH
 *     window.webUtils AND file.path are hidden. The host MUST expose a bridge
 *     (e.g. window.dshNative.getPathForFile) in its preload for plugins to
 *     reach the real path.
 *
 * Structure follows the official bundled client plugins (dsh-auto-compact):
 *   - window.__ModuleLoader__.load({ id, factory }) bundle
 *   - exports.apply(ctx) / exports.inject — plugin entry
 *   - ctx.slots.inject("conversation.composer.dock", ...) — an INVISIBLE dock
 *     occupant tracks the current session, so drops land in the right
 *     conversation.
 *   - ctx.effect(fn, name) — fiber-lifetime listeners.
 *
 * This plugin demonstrates the Electron-only fast path:
 *   1. listens for drag&drop on the whole document,
 *   2. on drop, resolves each file's real path via the host bridge,
 *   3. APPENDS the real paths to the composer draft via conversation.input
 *      (read-modify-write — never replaces what you typed),
 *   4. if NOT running in Electron, says so loudly and does nothing — the
 *      point being that the "fast drag-to-path" feature is Electron-bound.

 */
window.__ModuleLoader__.load({
  id: '@dsh-community/dsh-drop-to-path-electron',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');
    var h = react.createElement;

    // ---- host detection ---------------------------------------------------
    function isElectronHost() {
      if (typeof window === 'undefined') return false;
      try {
        if (typeof window.webUtils !== 'undefined') return true;
        if (typeof window.process !== 'undefined' && window.process.versions && window.process.versions.electron) return true;
        if (/electron/i.test(navigator.userAgent || '')) return true;
      } catch { /* ignore */ }
      return false;
    }

    // ---- real path extraction ----------------------------------------------
    // Returns the REAL absolute path, or null when the host hides it.
    // VERIFIED: in a sandboxed Electron renderer (contextIsolation+sandbox+no
    // nodeIntegration), BOTH window.webUtils and file.path are HIDDEN. The ONLY
    // working route is a preload-exposed bridge. So we first ask the host bridge
    // (window.dshNative / etc.), then the (usually absent) globals as fallback.
    // True for Windows/macOS absolute paths; rejects bridge stubs like "?".
    function isAbsolutePath(p) {
      return /^[a-zA-Z]:[\\/]/.test(p) || /^\/\//.test(p) || /^\//.test(p);
    }

    function realPathOf(file) {
      // 1) Host-exposed bridge via preload + contextBridge (the reliable way).
      try {
        const bridgeNames = ['dshNative', 'dshFiles', 'dshFile'];
        for (const name of bridgeNames) {
          const bridge = window[name];
          if (bridge && typeof bridge.getPathForFile === 'function') {
            const p = bridge.getPathForFile(file);
            if (typeof p === 'string' && isAbsolutePath(p)) return p;
          }
        }
      } catch { /* ignore */ }
      // 2) window.webUtils — NOT exposed in sandboxed Electron (kept for hosts that expose it).
      try {
        if (window.webUtils && typeof window.webUtils.getPathForFile === 'function') {
          const p = window.webUtils.getPathForFile(file);
          if (typeof p === 'string' && isAbsolutePath(p)) return p;
        }
      } catch { /* ignore */ }
      // 3) Legacy File.path — hidden in sandboxed Electron (kept as fallback).
      try { if (file && typeof file.path === 'string' && isAbsolutePath(file.path)) return file.path; } catch { /* ignore */ }
      return null;
    }

    // ---- composer access via the real conversation input ----------------------
    // The invisible dock occupant keeps track of the CURRENT session so the
    // drop handler writes into the right conversation. Paths are APPENDED to
    // whatever the user already typed (official read-modify-write via
    // conversation.input, same pattern as dsh-better-sidebar) - never replaced,
    // so a drop can't wipe an in-progress draft. The DOM textarea is a last
    // resort for hosts where the conversation service is unavailable.
    var currentSessionId = null;

    function DropPathCapture(props) {
      var sessionId = props.sessionId;
      react.useEffect(function () {
        if (sessionId) currentSessionId = sessionId;
        return function () {
          if (currentSessionId === sessionId) currentSessionId = null;
        };
      }, [sessionId]);
      return null;
    }

    // Append paths to the composer draft without clobbering existing text.
    // 1) official: conversation.input.for(actx) read-modify-write
    // 2) fallback: composer textarea via the value setter
    function writeIntoComposer(ctx, paths) {
      var text = paths.join('\n');
      if (currentSessionId) {
        try {
          var actx = ctx.sessions.scope(currentSessionId);
          var conversation = ctx.get('conversation');
          if (actx && conversation) {
            var input = conversation.input.for(actx);
            var draft = input.state.getSnapshot().draft;
            input.setDraft(draft.trim() === '' ? text : draft + '\n' + text);
            return true;
          }
        } catch { /* fall through to DOM */ }
      }
      try {
        var card = document.querySelector('[data-composer-card]');
        var ta = card ? card.querySelector('textarea') : null;
        if (ta instanceof HTMLTextAreaElement && !ta.readOnly && !ta.disabled) {
          var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ta.value.length ? ta.value + '\n' + text : text);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      } catch { /* ignore */ }
      return false;
    }

    // ---- tiny feedback -------------------------------------------------------
    function toast(msg) {
      try {
        var el = document.createElement('div');
        el.textContent = msg;
        Object.assign(el.style, {
          position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)',
          zIndex: 999999, background: 'rgba(0,0,0,.8)', color: '#fff',
          padding: '8px 14px', borderRadius: '8px', fontSize: '13px',
          fontFamily: 'system-ui, sans-serif', pointerEvents: 'none'
        });
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 3200);
      } catch { /* ignore */ }
    }

    // ---- drag & drop listeners ------------------------------------------------
    function makeListeners(ctx) {
      function hasFiles(e) { return !!(e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')); }
      return {
        dragover: function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
        drop: function (e) {
          if (!hasFiles(e)) return;
          e.preventDefault();
          // Detect per drop, not once: a bridge may be injected after load.
          if (!isElectronHost()) {
            toast('[dsh-drop-to-path] 普通浏览器拿不到真实路径 —— 请用桌面版/Electron 宿主');
            console.warn('[dsh-drop-to-path] Not an Electron host; real absolute paths are unavailable in a plain browser.');
            return;
          }
          var files = Array.prototype.slice.call(e.dataTransfer.files || []);
          var paths = files.map(function (f) { return realPathOf(f); }).filter(function (p) { return typeof p === 'string'; });
          if (paths.length === 0) {
            toast('[dsh-drop-to-path] 未能解析真实路径（webUtils 不可用?）');
            return;
          }
          var ok = writeIntoComposer(ctx, paths);
          toast('[dsh-drop-to-path] 已注入 ' + paths.length + ' 条真实路径' + (ok ? '' : '（未找到输入框）'));
          console.log('[dsh-drop-to-path] real paths:', paths);
        }
      };
    }

    // ---- plugin ---------------------------------------------------------------
    var inject = ['slots', 'sessions'];

    function apply(ctx) {
      var slots = ctx.slots;
      // Invisible composer-dock occupant that tracks the current session.
      slots.inject('conversation.composer.dock', function () {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'dsh-drop-to-path-electron-capture', order: 91 },
          DropPathCapture
        );
      });

      var handlers = makeListeners(ctx);
      ctx.effect(function () {
        document.addEventListener('dragover', handlers.dragover);
        document.addEventListener('drop', handlers.drop);
        return function () {
          document.removeEventListener('dragover', handlers.dragover);
          document.removeEventListener('drop', handlers.drop);
        };
      }, 'dsh-drop-to-path-electron: drag&drop');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});