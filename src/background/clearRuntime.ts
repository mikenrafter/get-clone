import type { BrowserApi, Tab } from '../models'

export interface ClearRuntime {
	clearDomain(tab: Tab): Promise<void>
}

export function getBaseDomain(hostname: string): string {
	const labels = hostname.split('.')
	if (labels.length <= 2) {
		return hostname
	}
	return labels.slice(-2).join('.')
}

export interface ClearRuntimeDeps {
	readonly browserApi: BrowserApi
}

export class ClearRuntimeImpl implements ClearRuntime {
	constructor(private readonly deps: ClearRuntimeDeps) {}

	async clearDomain(tab: Tab): Promise<void> {
		const { browserApi } = this.deps

		const baseDomain = getBaseDomain(new URL(tab.url ?? '').hostname)

		const tabs = await browserApi.tabs.query({
			...(tab.cookieStoreId !== undefined ? { cookieStoreId: tab.cookieStoreId } : {}),
		})

		const matchedTabs = tabs.filter(t => {
			const hostname = new URL(t.url ?? '').hostname
			return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)
		})

		const distinctHostnames = Array.from(new Set(matchedTabs.map(t => new URL(t.url ?? '').hostname)))

		for (const matchedTab of matchedTabs) {
			await browserApi.tabs.remove(matchedTab.id as number)
		}

		const hostnames = distinctHostnames.length > 0 ? distinctHostnames : [baseDomain]

		await browserApi.browsingData.remove(
			{
				...(tab.cookieStoreId !== undefined ? { cookieStoreId: tab.cookieStoreId } : {}),
				hostnames,
			},
			{ cookies: true, localStorage: true, indexedDB: true },
		)
	}
}
