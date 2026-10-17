/**
 * With Temporary Containers installed: "New Temporary Container" opens the
 * page signed in, in a fresh temporary container, and the menu leads with
 * temporary or permanent containers depending on where the tab is.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { menuItem, selectedTab, type FirefoxSession } from 'firefox-addon-live'
import { SITE_URL, TEMPORARY_CONTAINERS_ID, TEMPORARY_CONTAINERS_XPI, cookieStoreId, ensureContainer, sessionCookie, signIn, startGetClone, tabs } from './getClone'

let session: FirefoxSession
let personalId: number
let personal: string

const greeting = () => session.content(`return document.getElementById('greeting')?.textContent || null`)
const isTemporary = (storeId: string) => session.asExtension(
	'return await browser.runtime.sendMessage(args[0], { method: "isTempContainer", cookieStoreId: args[1] })',
	[TEMPORARY_CONTAINERS_ID, storeId],
)

async function tabMenu(...path: string[]): Promise<void> {
	await session.realClick(selectedTab, { button: 3 })
	await session.waitForPopup('tabContextMenu')
	for (const label of path) {
		const item = menuItem('tabContextMenu', label)
		await session.waitForTarget(item)
		await session.realClick(item)
	}
}

describe.skipIf(!TEMPORARY_CONTAINERS_XPI)('with Temporary Containers', () => {
	beforeAll(async () => {
		session = await startGetClone({ width: 800, height: 562, temporaryContainers: true })
		personalId = await ensureContainer(session, 'Personal', 'blue', 'fingerprint')
		personal = cookieStoreId(personalId)
	}, 90_000)

	afterAll(async () => {
		await session?.close()
	})

	it('clones into a new temporary container, signed in, and discards the source tab', async () => {
		await signIn(session, personal)
		await session.openTab(SITE_URL, personalId)

		await tabMenu('Clone to Temporary Container', 'New Temporary Container')

		await expect.poll(async () => (await tabs(session)).filter((tab) => tab.url === SITE_URL).length).toBe(2)
		const [source, clone] = (await tabs(session)).filter((tab) => tab.url === SITE_URL)
		expect(source).toMatchObject({ cookieStoreId: personal, active: false })
		expect(clone).toMatchObject({ active: true })
		expect(clone!.cookieStoreId).not.toBe(personal)
		expect(await isTemporary(clone!.cookieStoreId)).toBe(true)
		expect(await sessionCookie(session, clone!.cookieStoreId)).toBe('alice')
		await expect.poll(greeting).toBe('Signed in as alice')
		await expect.poll(async () => (await tabs(session)).find((tab) => tab.cookieStoreId === personal)?.discarded).toBe(true)
	})

	it('leads with permanent containers when the tab is in a temporary one', async () => {
		await tabMenu('Clone to Permanent Container', 'Personal')
		await expect.poll(async () => (await tabs(session)).filter((tab) => tab.url === SITE_URL && tab.cookieStoreId === personal).length).toBe(2)
		expect(await greeting()).toBe('Signed in as alice')
	})
})
