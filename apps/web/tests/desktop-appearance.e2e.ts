/** Browser CSS regression for desktop injection into independently built client layouts. */
import { chromium, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { instanceAppearanceCss } from '../../desktop/src/instance-appearance.ts'
import { DEFAULT_PERSONAL_APPEARANCE } from '../../desktop/src/personal-appearance.ts'

async function fixture(modern: boolean): Promise<Page> {
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage()
  // Released clients paint bg-base at each ancestor; newer clients expose separate fill tokens.
  await page.setContent(`<style>
body { --dsw-alias-bg-base: white; --dsw-alias-bg-layer-1: white;
  --dsw-alias-bg-layer-2: white; --dsw-alias-bg-layer-3: white;
  --dsw-specific-sidebar-fill: #f5f6f8; --dsw-specific-input-major: white;
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); }
[data-slot] { display: contents; }
.release_frame { background: var(${modern ? '--dsw-alias-app-fill, var(--dsw-alias-bg-base)' : '--dsw-alias-bg-base'}); }
.release_sidebar, .release_navigation { background: var(--dsw-specific-sidebar-fill); }
.release_center, .release_right { background: var(--dsw-alias-bg-base); }
.release_conversation { background: var(${modern ? '--dsw-alias-content-fill, var(--dsw-alias-bg-base)' : '--dsw-alias-bg-base'}); }
.release_composer { background: linear-gradient(transparent, var(--dsw-alias-bg-base)); }
.release_input { background: var(--dsw-specific-input-major); }
.release_card { background: var(--dsw-alias-bg-layer-1); }
.release_dialog { background: var(--dsw-alias-bg-layer-2); }
.release_menu { background: var(--dsw-specific-menu); }
</style><div data-slot="root"><div class="release_frame">
  <aside class="release_sidebar"><div data-slot="sidebar"><nav class="release_navigation">Navigation</nav></div></aside>
  <main class="release_center"><div data-slot="main"><div data-slot="main.conversation">
    <section class="release_conversation"><div class="release_composer"><div class="release_input">Input</div></div></section>
  </div></div></main>
  <aside class="release_right" data-rightbar-col><div class="release_card">Details</div></aside>
</div></div><div class="release_menu" role="menu">Menu</div>
<div class="release_dialog" role="dialog"><div class="release_card">Dialog content</div></div>`)
  return page
}

async function backgrounds(page: Page) {
  return page.evaluate(() => Object.fromEntries(
    ['frame', 'sidebar', 'navigation', 'center', 'conversation', 'input', 'right', 'card', 'menu', 'dialog']
      .map(name => [name, getComputedStyle(document.querySelector(`.release_${name}`)!).backgroundColor]),
  ))
}

for (const modern of [false, true]) {
  it(`keeps one translucent region across ${modern ? 'desktop-aware' : 'released'} client layouts and restores the palette`, async () => {
    const page = await fixture(modern)
    const base = await backgrounds(page)
    const style = await page.addStyleTag({ content: instanceAppearanceCss({ ...DEFAULT_PERSONAL_APPEARANCE,
      backgroundImage: 'data:image/png;base64,AA==', surfaceOpacity: 25 }) })
    const colors = await backgrounds(page)
    expect(colors.frame).toBe('rgba(0, 0, 0, 0)')
    expect(colors.navigation).toBe('rgba(0, 0, 0, 0)')
    expect(colors.conversation).toBe('rgba(0, 0, 0, 0)')
    expect(colors.card).toBe('rgba(0, 0, 0, 0)')
    expect(colors.center).toBe('color(srgb 1 1 1 / 0.25)')
    expect(colors.right).toBe(colors.center)
    expect(colors.sidebar).toMatch(/\/ 0\.25\)$/u)
    expect(colors.input).toBe(colors.center)
    expect(colors.menu).toBe('rgb(255, 255, 255)')
    expect(colors.dialog).toBe(colors.menu)
    expect(await page.locator('[role=dialog] .release_card').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(colors.menu)
    expect(await page.locator('.release_composer').evaluate(node => getComputedStyle(node).backgroundImage)).not.toContain('rgb(255, 255, 255)')

    // Internal pages mount after injection and share the existing main column fill.
    await page.locator('[data-slot=main]').evaluate((node) => {
      node.innerHTML = '<section class="release_card">Settings</section>'
    })
    expect(await page.locator('main .release_card').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await style.evaluate((node) => { node.parentNode!.removeChild(node) })
    expect(await page.locator('.release_center').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(base.center)
    expect(await page.locator('.release_navigation').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(base.navigation)
  })
}

it('uses dark and custom region colors at zero and full panel opacity without fading text', async () => {
  const page = await fixture(false)
  await page.evaluate(() => { document.body.dataset.dsDarkTheme = '' })
  for (const surfaceOpacity of [0, 100]) {
    const style = await page.addStyleTag({ content: instanceAppearanceCss({ ...DEFAULT_PERSONAL_APPEARANCE,
      backgroundImage: 'data:image/png;base64,AA==', surfaceOpacity,
      colors: { ...DEFAULT_PERSONAL_APPEARANCE.colors, content: '#112233', text: '#aabbcc' } }) })
    expect((await backgrounds(page)).center).toBe(surfaceOpacity === 0
      ? 'color(srgb 0 0 0 / 0)' : 'color(srgb 0.0666667 0.133333 0.2)')
    expect((await backgrounds(page)).menu).toBe('rgb(17, 34, 51)')
    expect(await page.locator('.release_center').evaluate(node => getComputedStyle(node).opacity)).toBe('1')
    expect(await page.locator('.release_input').evaluate(node => getComputedStyle(node).color)).toBe('rgb(170, 187, 204)')
    await style.evaluate((node) => { node.parentNode!.removeChild(node) })
  }
  const style = await page.addStyleTag({ content: instanceAppearanceCss({ ...DEFAULT_PERSONAL_APPEARANCE,
    backgroundImage: 'data:image/png;base64,AA==', surfaceOpacity: 25 }) })
  expect((await backgrounds(page)).center).toBe('color(srgb 0.0823529 0.0823529 0.0901961 / 0.25)')
  await style.evaluate((node) => { node.parentNode!.removeChild(node) })
})
