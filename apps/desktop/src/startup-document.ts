/** Self-contained recovery document for an unavailable shell renderer or preload. */

import type { DesktopLocale } from './locale.ts'

/**
 * Render a local loading screen before data migration and kernel preparation.
 * @param locale - Saved language, or operating-system locale when no preference is stored.
 * @param loadingCss - Shell-owned animation stylesheet embedded before the asset protocol is ready.
 * @param detail - Current installation stage; omitted before initialization starts.
 * @param appearanceCss - Validated shell-owned wallpaper and palette rules.
 * @returns A script-free document with reduced-motion support.
 */
export function startupLoadingDocument(locale: DesktopLocale, loadingCss: string, detail?: string, appearanceCss = ''): string {
  const escaped = detail?.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html><html lang="${locale.id}"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>DshManager</title><style>
:root{color-scheme:light dark;font-family:system-ui}body{margin:0;display:grid;place-items:center;height:100vh;background:light-dark(#fafafa,#171719);color:light-dark(#202124,#ededf0)}
main{max-width:min(700px,calc(100vw - 64px));text-align:center}h1{font-size:22px;font-weight:600}p{opacity:.65;font-size:14px;line-height:1.6;overflow-wrap:anywhere}
${loadingCss}\n${appearanceCss}</style>
<main aria-busy="true" role="status"><div class="dsh-loader" aria-hidden="true"><span></span></div><h1>${locale.messages.startupLoading}</h1><p id="startup-detail" aria-live="polite">${escaped ?? locale.messages.startupLoadingDescription}</p></main></html>`
}

/**
 * Render escaped diagnostics without depending on application resource files.
 * @param locale - Shell-owned translations.
 * @param message - Failure details displayed as plain text.
 * @param profileRecovery - Whether the initialized application can repair its profile.
 * @returns An HTML document suitable for an isolated emergency window.
 */
export function startupFailureDocument(locale: DesktopLocale, message: string, profileRecovery = false): string {
  const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  return `<!doctype html><html lang="${locale.id}"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action dsh-recovery:">
<title>${escape(locale.messages.startupFailed)}</title>
<style>:root{color-scheme:light dark;font-family:system-ui}body{max-width:720px;margin:10vh auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h1>${escape(locale.messages.startupFailed)}</h1><p>${escape(locale.messages.startupReinstallAdvice)}</p>
${profileRecovery ? `<p>${escape(locale.messages.startupConfigurationAdvice)}</p>` : ''}
<pre role="alert">${escape(message)}</pre>
<form action="dsh-recovery://restart"><button>${escape(locale.messages.restartApplication)}</button></form>
${profileRecovery ? `<form action="dsh-recovery://plugins"><button>${escape(locale.messages.disableThirdPartyPlugins)}</button></form>
<form action="dsh-recovery://reset"><button>${escape(locale.messages.resetConfiguration)}</button></form>` : ''}
</main></html>`
}
