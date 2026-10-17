/**
 * Regenerates the README captures in product-page/ from a real Firefox with
 * Get Clone and Temporary Containers loaded, on a private Xvfb display:
 *
 *   usage-permanent   sign in inside a temporary container, then clone the tab
 *                     into Work: it opens there signed in, the source is discarded
 *   usage-temporary   clone a signed-in Personal tab into a new temporary container
 *   usage-clear       Clear Site Data for This Container signs Work out and
 *                     closes its tabs for the site; Personal stays signed in
 *   restricted-site   the help page shown when Firefox blocks an action (PNG only)
 *
 * Each usage scene writes a 640px-wide GIF (real X pointer, recorded with
 * ffmpeg) and a PNG still. The site is a local fixture (mail.example) that
 * shows who is signed in from its session cookie. The harness is
 * firefox-addon-live (a flake input; see flake.nix), and `nix develop` fetches
 * the signed Temporary Containers .xpi.
 *
 * Usage (inside `nix develop`):
 *   npm run capture:readme                  # every scene
 *   npm run capture:readme -- clear         # only these scenes
 *   OUT_DIR=/tmp/shots npm run capture:readme
 */

import { resolve } from 'node:path'
import { GLIDE, menuItem, runCaptures, selectedTab, settle, waitFor, type FirefoxSession, type Target } from 'firefox-addon-live'
import { SITE_URL, TEMPORARY_CONTAINERS_ID, cookieStoreId, ensureContainer, getCloneSessionOptions, restartGetClone, signIn } from '../tests/live/getClone'

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

await runCaptures({
	outDir: resolve(import.meta.dirname, '../product-page'),
	session: getCloneSessionOptions({ temporaryContainers: true }),
	setup: restartGetClone,
	scenes: {
		permanent: {
			async run(session, kit) {
				await openInNewTemporaryContainer(session, SITE_URL)
				await settle(session)
				const stop = await kit.record('usage-permanent')
				await sleep(500)
				await session.realClick({ content: '#username' }, { glide: GLIDE })
				await session.type('alice')
				await sleep(300)
				await session.realClick({ content: '#sign-in' }, { glide: 12 })
				await waitForGreeting(session)
				await sleep(900)
				await openTabMenu(session, 'Clone to Permanent Container')
				await glideIntoSubmenu(session, menuItem('tabContextMenu', 'Work'))
				await sleep(600)
				await kit.still('usage-permanent')
				await session.pointerClick()
				await waitForGreeting(session)
				await parkPointer(session)
				await sleep(2_000)
				await stop()
			},
		},

		temporary: {
			async run(session, kit) {
				const personal = await ensureContainer(session, 'Personal', 'blue', 'fingerprint')
				await signIn(session, cookieStoreId(personal))
				await session.openTab(SITE_URL, personal)
				await settle(session)
				const stop = await kit.record('usage-temporary')
				await sleep(800)
				await openTabMenu(session, 'Clone to Temporary Container')
				await glideIntoSubmenu(session, menuItem('tabContextMenu', 'New Temporary Container'))
				await sleep(600)
				await kit.still('usage-temporary')
				await session.pointerClick()
				await waitForGreeting(session)
				await parkPointer(session)
				await sleep(2_000)
				await stop()
			},
		},

		clear: {
			async run(session, kit) {
				const personal = await ensureContainer(session, 'Personal', 'blue', 'fingerprint')
				const work = await ensureContainer(session, 'Work', 'orange', 'briefcase')
				await signIn(session, cookieStoreId(personal), 'alice')
				await signIn(session, cookieStoreId(work), 'bob')
				await session.openTab(SITE_URL, personal)
				await settle(session)
				await session.openTab(SITE_URL, work)
				const stop = await kit.record('usage-clear')
				await sleep(800)
				await openTabMenu(session, 'Clone to Temporary Container')
				await glideIntoSubmenu(session, menuItem('tabContextMenu', 'Clear Site Data for This Container'))
				await sleep(600)
				await kit.still('usage-clear')
				await session.pointerClick()
				// The Work tab closes; Personal is still signed in.
				await sleep(1_800)
				// Opening the site in Work again shows the sign-in form.
				await session.openTab(SITE_URL, work)
				await sleep(2_200)
				await stop()
			},
		},

		'restricted-site': {
			async run(session, kit) {
				await session.openTab(`${session.extensionOrigin}/info/restricted-site.html?domain=addons.mozilla.org`)
				await settle(session, { x: 790, y: 555 })
				await kit.still('restricted-site')
			},
		},
	},
})

/** Right-clicks the selected tab and glides to `label` in the tab context menu. */
async function openTabMenu(session: FirefoxSession, label: string): Promise<void> {
	await session.realClick(selectedTab, { button: 3, glide: GLIDE })
	await session.waitForPopup('tabContextMenu')
	const item = menuItem('tabContextMenu', label)
	await session.waitForTarget(item)
	await sleep(400)
	await session.pointerTo(item, GLIDE)
	await sleep(900)
}

/**
 * Moves sideways into the open submenu, then along it to `target`, so the
 * pointer never cuts across other items (or out of the submenu).
 */
async function glideIntoSubmenu(session: FirefoxSession, target: Target): Promise<void> {
	const rect = await session.screenRect(target)
	const pointer = await session.screenRect({ find: 'return document.querySelector("#tabContextMenu menu[_moz-menuactive]")' })
	await session.pointerToPoint(rect.x + 40, pointer.y + pointer.height / 2, 12)
	await sleep(150)
	await session.pointerToPoint(rect.x + 40, rect.y + rect.height / 2, 16)
}

async function waitForGreeting(session: FirefoxSession): Promise<void> {
	await waitFor(async () => await session.content(`return document.getElementById('greeting')?.textContent || null`).catch(() => null) as string | null ?? undefined, 10_000, 'Page never showed a signed-in user')
}

async function parkPointer(session: FirefoxSession): Promise<void> {
	await session.pointerToPoint(560, 420, GLIDE)
}

async function openInNewTemporaryContainer(session: FirefoxSession, url: string): Promise<void> {
	await session.asExtension(`await browser.runtime.sendMessage(args[0], { method: 'createTabInTempContainer', url: args[1], active: true }); return true`, [TEMPORARY_CONTAINERS_ID, url])
	await waitFor(async () => await session.chrome(`
		const browser = gBrowser.selectedBrowser
		return !browser.webProgress?.isLoadingDocument && browser.currentURI.spec === arguments[0] ? true : null`, [url]) as true | null ?? undefined, 15_000, `${url} never loaded`)
}
