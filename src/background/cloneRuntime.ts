import type { BrowserApi, Cookie, CookieSetDetails, Tab } from '../models'
import type { TcLayer } from './tcLayer'

export interface CloneRuntimeDeps {
	readonly browserApi: BrowserApi
	readonly tcLayer: TcLayer
}

export interface CloneRuntime {
	cloneToContainer(sourceTab: Tab, targetCookieStoreId: string): Promise<void>
	cloneToTemporary(sourceTab: Tab): Promise<void>
}

function cookieToSetDetails(cookie: Cookie, storeId: string): CookieSetDetails {
	const domain = cookie.domain.replace(/^\./, '')
	const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`

	const details: CookieSetDetails = {
		url,
		name: cookie.name,
		value: cookie.value,
		// Host-only cookies must not carry an explicit domain — Firefox derives it from `url`.
		// Passing one back (e.g. a leading-dot domain on a single-label host like "localhost")
		// can fail cookies.set validation even though the original cookie was valid.
		...(cookie.hostOnly ? {} : { domain: cookie.domain }),
		path: cookie.path,
		secure: cookie.secure,
		httpOnly: cookie.httpOnly,
		sameSite: cookie.sameSite,
		storeId,
	}

	if (cookie.expirationDate !== undefined) {
		details.expirationDate = cookie.expirationDate
	}

	return details
}

export class CloneRuntimeImpl implements CloneRuntime {
	constructor(private readonly deps: CloneRuntimeDeps) {}

	async cloneToContainer(sourceTab: Tab, targetCookieStoreId: string): Promise<void> {
		const { browserApi } = this.deps

		await this.copyCookies(sourceTab, targetCookieStoreId)

		const newTab = await browserApi.tabs.create({
			cookieStoreId: targetCookieStoreId,
			url: sourceTab.url ?? '',
			index: sourceTab.index + 1,
		})

		this.registerDiscardOnComplete(sourceTab, newTab)
	}

	async cloneToTemporary(sourceTab: Tab): Promise<void> {
		const { tcLayer } = this.deps

		const newTab = await tcLayer.createTempContainer(
			sourceTab.url ?? '',
			sourceTab.index + 1,
			sourceTab.windowId ?? 0,
		)

		await this.copyCookies(sourceTab, newTab.cookieStoreId ?? '')
		this.registerDiscardOnComplete(sourceTab, newTab)
	}

	private async copyCookies(sourceTab: Tab, targetCookieStoreId: string): Promise<void> {
		const { browserApi } = this.deps

		const cookies = await browserApi.cookies.getAll({ storeId: sourceTab.cookieStoreId ?? '' })
		for (const cookie of cookies) {
			try {
				await browserApi.cookies.set(cookieToSetDetails(cookie, targetCookieStoreId))
			} catch (error) {
				// One cookie's own quirks (e.g. Firefox rejecting a leading-dot domain on a
				// single-label host) shouldn't abort the clone for every other cookie.
				console.warn(`get-clone: failed to copy cookie "${cookie.name}" for ${cookie.domain}`, error)
			}
		}
	}

	private registerDiscardOnComplete(sourceTab: Tab, newTab: Tab): void {
		const { browserApi } = this.deps

		browserApi.tabs.onUpdated.addListener(async (id, changeInfo) => {
			if (id === newTab.id && changeInfo.status === 'complete') {
				await browserApi.tabs.discard(sourceTab.id as number)
			}
		})
	}
}
