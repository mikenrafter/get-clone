/**
 * Starts a live Firefox (see firefox-addon-live) with Get Clone loaded from
 * `src/`, and serves a fixture site whose page shows who is signed in.
 */

import { resolve } from 'node:path'
import { FirefoxSession, waitFor, type FirefoxSession as Session, type FirefoxSessionOptions, type FixturePage } from 'firefox-addon-live'
import { TEMP_CONTAINERS_EXTENSION_IDS } from '../../src/constants'

export const EXTENSION_ID = 'get-clone@get-clone'
export const EXTENSION_SOURCE = resolve(import.meta.dirname, '../../src')
/** Temporary Containers (stoically), the signed .xpi `nix develop` fetches. */
export const TEMPORARY_CONTAINERS_ID = TEMP_CONTAINERS_EXTENSION_IDS[0]
export const TEMPORARY_CONTAINERS_XPI = process.env.TEMPORARY_CONTAINERS_XPI

export const SITE = 'mail.example'
export const SITE_URL = `http://${SITE}/inbox`

/** The cookie the fixture site signs in with. */
export const SESSION_COOKIE = 'session'

/**
 * A mail site that shows "Signed in as <user>" when its session cookie is
 * set, and a sign-in form otherwise. Signing in sets the cookie and reloads.
 */
export function accountPage(product: string, accent: string): FixturePage {
	return {
		title: product,
		body: `
<style>
	body { padding: 24px 32px; }
	header { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 18px; }
	header i { width: 26px; height: 22px; border-radius: 5px; background: ${accent}; display: inline-block; }
	header span { margin-left: auto; font-weight: 400; font-size: 14px; color: #555; }
	main { margin: 36px auto 0; max-width: 280px; background: white; border-radius: 14px; padding: 28px; box-shadow: 0 2px 12px #0001; }
	h1 { margin: 0 0 6px; font-size: 22px; }
	p { margin: 0 0 18px; color: #555; font-size: 13px; }
	label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
	input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 8px; }
	button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: ${accent}; color: white; font-size: 14px; }
	.avatar { width: 56px; height: 56px; border-radius: 50%; background: ${accent}; color: white; font-size: 26px; font-weight: 600;
		display: flex; align-items: center; justify-content: center; margin-bottom: 14px; text-transform: uppercase; }
	li { font-size: 14px; padding: 6px 0; border-top: 1px solid #eee; list-style: none; }
	ul { padding: 0; margin: 0; }
	[hidden] { display: none !important; }
</style>
<header><i></i>${product}<span id="who"></span></header>
<main id="signed-out" hidden>
	<h1>Sign in</h1>
	<p>To continue to ${product}</p>
	<label for="username">Username</label><input id="username" autocomplete="off">
	<button id="sign-in">Sign in</button>
</main>
<main id="signed-in" hidden>
	<div class="avatar" id="avatar"></div>
	<h1 id="greeting"></h1>
	<p>3 unread messages</p>
	<ul><li>Lunch on Friday?</li><li>Your invoice is ready</li><li>Weekly report</li></ul>
</main>
<script>
	const user = document.cookie.split('; ').find((part) => part.startsWith('${SESSION_COOKIE}='))?.slice(${SESSION_COOKIE.length + 1})
	if (user) {
		document.getElementById('greeting').textContent = 'Signed in as ' + user
		document.getElementById('avatar').textContent = user[0]
		document.getElementById('who').textContent = user
		document.getElementById('signed-in').hidden = false
	} else {
		document.getElementById('signed-out').hidden = false
	}
	document.getElementById('sign-in').addEventListener('click', () => {
		const name = document.getElementById('username').value.trim() || 'alice'
		document.cookie = '${SESSION_COOKIE}=' + encodeURIComponent(name) + '; path=/'
		location.reload()
	})
</script>`,
	}
}

export interface GetCloneOptions extends Omit<FirefoxSessionOptions, 'addon' | 'extraAddons'> {
	/** Also install Temporary Containers (needs TEMPORARY_CONTAINERS_XPI, set by `nix develop`). */
	temporaryContainers?: boolean
}

/** Session options with Get Clone, the fixture site and, optionally, Temporary Containers. */
export function getCloneSessionOptions(options: GetCloneOptions = {}): FirefoxSessionOptions {
	const { temporaryContainers, ...rest } = options
	if (temporaryContainers && !TEMPORARY_CONTAINERS_XPI) throw new Error('TEMPORARY_CONTAINERS_XPI is not set (run inside nix develop)')
	return {
		pages: { [SITE]: accountPage('Mail', '#6d4aff') },
		bookmarksToolbar: false,
		...rest,
		prefs: {
			'signon.rememberSignons': false,
			...rest.prefs,
		},
		addon: { source: EXTENSION_SOURCE, id: EXTENSION_ID },
		...(temporaryContainers ? { extraAddons: [TEMPORARY_CONTAINERS_XPI!] } : {}),
	}
}

/** Run `npm run build` first; the add-on loads from the built `src/`. */
export async function startGetClone(options: GetCloneOptions = {}): Promise<Session> {
	const session = await FirefoxSession.start(getCloneSessionOptions(options))
	try {
		if (options.temporaryContainers) await restartGetClone(session)
		return session
	} catch (error) {
		await session.close()
		throw error
	}
}

/**
 * Get Clone looks for Temporary Containers once, at startup, and the harness
 * installs extra add-ons after it; reload it so it finds TC.
 */
export async function restartGetClone(session: Session): Promise<void> {
	await session.chromeAsync(`
		const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs')
		const addon = await AddonManager.getAddonByID(args[0])
		await addon.reload()
		return true`, [EXTENSION_ID])
	await waitFor(async () => await session.asExtension(`
		const info = await browser.management.get(args[0])
		return info.enabled ? true : null`, [TEMPORARY_CONTAINERS_ID]).catch(() => undefined) ?? undefined, 15_000, 'Get Clone never came back after reload')
	await new Promise<void>((done) => setTimeout(done, 1_000))
}

/**
 * Creates (or finds) a container by name and returns its userContextId.
 * Uses the add-on's contextualIdentities API: the harness's `ensureContainer`
 * imports ContextualIdentityService from resource://gre/modules/, which
 * Firefox 154 moved to moz-src:///.
 */
export async function ensureContainer(session: Session, name: string, color: string, icon: string): Promise<number> {
	const storeId = await session.asExtension(`
		const [existing] = await browser.contextualIdentities.query({ name: args[0] })
		return (existing ?? await browser.contextualIdentities.create({ name: args[0], color: args[1], icon: args[2] })).cookieStoreId`,
	[name, color, icon]) as string
	return Number(storeId.replace('firefox-container-', ''))
}

/** Cookie store id for a container's userContextId (0 is no container). */
export function cookieStoreId(userContextId: number): string {
	return userContextId === 0 ? 'firefox-default' : `firefox-container-${userContextId}`
}

/** Sets the fixture site's session cookie in a container, as if the user signed in there. */
export async function signIn(session: Session, storeId: string, user = 'alice'): Promise<void> {
	await session.asExtension(`
		await browser.cookies.set({ url: args[0], name: args[1], value: args[2], storeId: args[3] })
		return true`, [`http://${SITE}/`, SESSION_COOKIE, user, storeId])
}

/** The fixture site's session cookie value in a container, or null. */
export async function sessionCookie(session: Session, storeId: string): Promise<string | null> {
	return await session.asExtension(`
		const cookie = await browser.cookies.get({ url: args[0], name: args[1], storeId: args[2] })
		return cookie?.value ?? null`, [`http://${SITE}/`, SESSION_COOKIE, storeId]) as string | null
}

/** Tabs in the window, as the WebExtension API sees them. */
export async function tabs(session: Session): Promise<Array<{ url: string, cookieStoreId: string, discarded: boolean, active: boolean }>> {
	return await session.asExtension(`
		return (await browser.tabs.query({ currentWindow: true }))
			.filter((tab) => !tab.url.startsWith(location.origin))
			.map(({ url, cookieStoreId, discarded, active }) => ({ url, cookieStoreId, discarded, active }))`) as Array<{ url: string, cookieStoreId: string, discarded: boolean, active: boolean }>
}
