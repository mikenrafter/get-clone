/**
 * Without Temporary Containers: "Clone to Container" copies the site's
 * cookies into the picked container, opens the page there signed in, and
 * discards the source tab. "Clear Site Data for This Container" signs that
 * container out and closes its tabs for the site, leaving other containers alone.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { menuItem, selectedTab, type FirefoxSession } from 'firefox-addon-live'
import { SITE_URL, cookieStoreId, ensureContainer, sessionCookie, signIn, startGetClone, tabs } from './getClone'

let session: FirefoxSession
/** userContextIds, for opening tabs. */
let personalId: number
let workId: number
/** Their cookie store ids, for the WebExtension API. */
let personal: string
let work: string

const greeting = () => session.content(`return document.getElementById('greeting')?.textContent || null`)

/** Right-clicks the selected tab and follows `path` through the tab context menu. */
async function tabMenu(...path: string[]): Promise<void> {
	await session.realClick(selectedTab, { button: 3 })
	await session.waitForPopup('tabContextMenu')
	for (const label of path) {
		const item = menuItem('tabContextMenu', label)
		// Get Clone builds its items when the menu is shown.
		await session.waitForTarget(item)
		await session.realClick(item)
	}
}

beforeAll(async () => {
	session = await startGetClone({ width: 800, height: 562 })
	personalId = await ensureContainer(session, 'Personal', 'blue', 'fingerprint')
	workId = await ensureContainer(session, 'Work', 'orange', 'briefcase')
	personal = cookieStoreId(personalId)
	work = cookieStoreId(workId)
}, 90_000)

afterAll(async () => {
	await session?.close()
})

beforeEach(async () => {
	await session.openTab('about:blank')
	await session.closeOtherTabs()
	await session.asExtension('await browser.browsingData.removeCookies({}); return true')
})

describe('Clone to Container', () => {
	it('opens the page in the picked container, signed in, and discards the source tab', async () => {
		await signIn(session, personal)
		await session.openTab(SITE_URL, personalId)
		expect(await greeting()).toBe('Signed in as alice')
		expect(await sessionCookie(session, work)).toBeNull()

		await tabMenu('Clone to Container', 'Work')

		await expect.poll(() => sessionCookie(session, work)).toBe('alice')
		await expect.poll(async () => (await tabs(session)).filter((tab) => tab.url === SITE_URL)).toEqual([
			{ url: SITE_URL, cookieStoreId: personal, discarded: true, active: false },
			{ url: SITE_URL, cookieStoreId: work, discarded: false, active: true },
		])
		expect(await greeting()).toBe('Signed in as alice')
	})

	it('lists every container, with the current one disabled', async () => {
		await session.openTab(SITE_URL, workId)
		await tabMenu('Clone to Container')
		const items = await session.chrome(`
			const popup = [...document.getElementById('tabContextMenu').querySelectorAll('menupopup')].find((p) => p.state === 'open')
			return [...popup.children].filter((item) => !item.hidden && item.label).map((item) => ({ label: item.label, disabled: item.disabled }))`)
		await session.keys('Escape')
		await session.keys('Escape')
		expect(items).toEqual(expect.arrayContaining([
			{ label: 'No Container', disabled: false },
			{ label: 'Personal', disabled: false },
			{ label: 'Work', disabled: true },
			{ label: 'Clear Site Data for This Container', disabled: false },
		]))
	})
})

describe('Clear Site Data for This Container', () => {
	it("signs the container out and closes its tabs for the site, leaving other containers alone", async () => {
		await signIn(session, personal)
		await signIn(session, work, 'bob')
		await session.openTab(SITE_URL, personalId)
		await session.openTab(SITE_URL, workId)
		expect(await greeting()).toBe('Signed in as bob')

		await tabMenu('Clone to Container', 'Clear Site Data for This Container')

		await expect.poll(() => sessionCookie(session, work)).toBeNull()
		expect(await sessionCookie(session, personal)).toBe('alice')
		await expect.poll(async () => (await tabs(session)).filter((tab) => tab.url === SITE_URL).map((tab) => tab.cookieStoreId)).toEqual([personal])

		await session.openTab(SITE_URL, workId)
		expect(await greeting()).toBeNull()
		expect(await session.content(`return !document.getElementById('signed-out').hidden`)).toBe(true)
	})
})
