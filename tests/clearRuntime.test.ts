import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClearRuntimeImpl, getBaseDomain } from '../src/background/clearRuntime'
import type { BrowserApi, Tab } from '../src/models'

function makeBrowserApi(): BrowserApi {
	return {
		menus: {
			create: vi.fn().mockResolvedValue(undefined),
			removeAll: vi.fn().mockResolvedValue(undefined),
			refresh: vi.fn().mockResolvedValue(undefined),
			onShown: { addListener: vi.fn() },
			onClicked: { addListener: vi.fn() },
		},
		tabs: {
			create: vi.fn(),
			get: vi.fn(),
			discard: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue([]),
			remove: vi.fn().mockResolvedValue(undefined),
			executeScript: vi.fn().mockResolvedValue([]),
			onUpdated: { addListener: vi.fn() },
		},
		contextualIdentities: {
			query: vi.fn().mockResolvedValue([]),
			get: vi.fn(),
		},
		cookies: {
			getAll: vi.fn().mockResolvedValue([]),
			set: vi.fn().mockResolvedValue(null),
			remove: vi.fn().mockResolvedValue(undefined),
		},
		browsingData: {
			remove: vi.fn().mockResolvedValue(undefined),
		},
		runtime: {
			sendMessage: vi.fn().mockResolvedValue(false),
			getURL: vi.fn((path: string) => `moz-extension://test/${path}`),
		},
		management: {
			get: vi.fn().mockRejectedValue(new Error('not installed')),
		},
	}
}

// ---------------------------------------------------------------------------
// getBaseDomain — naive last-two-dot-labels heuristic
// ---------------------------------------------------------------------------

describe('getBaseDomain', () => {
	it('strips a single subdomain label', () => {
		expect(getBaseDomain('sub.example.com')).toBe('example.com')
	})

	it('leaves an already-bare two-label domain unchanged', () => {
		expect(getBaseDomain('example.com')).toBe('example.com')
	})

	it('strips multiple subdomain labels down to the last two', () => {
		expect(getBaseDomain('a.b.example.com')).toBe('example.com')
	})

	it('returns a single-label host as-is (nothing to strip)', () => {
		expect(getBaseDomain('localhost')).toBe('localhost')
	})
})

// ---------------------------------------------------------------------------
// ClearRuntimeImpl.clearDomain
// ---------------------------------------------------------------------------

const sourceTab: Tab = {
	id: 1,
	url: 'https://sub.example.com/page',
	index: 0,
	cookieStoreId: 'firefox-container-1',
	windowId: 1,
}

// Fixture of every open tab across every container. tabs.query is mocked to
// mimic the real API's cookieStoreId scoping, so the runtime under test only
// ever sees the slice belonging to the requested container.
const allTabsFixture: Tab[] = [
	{ id: 10, url: 'https://example.com/', index: 0, cookieStoreId: 'firefox-container-1' }, // base domain exact match
	{ id: 11, url: 'https://sub.example.com/a', index: 1, cookieStoreId: 'firefox-container-1' }, // subdomain match
	{ id: 12, url: 'https://sub.example.com/b', index: 2, cookieStoreId: 'firefox-container-1' }, // same hostname as 11 -> dedup target
	{ id: 13, url: 'https://unrelated.org/', index: 3, cookieStoreId: 'firefox-container-1' }, // same container, unrelated domain
	{ id: 14, url: 'https://example.com/', index: 4, cookieStoreId: 'firefox-container-2' }, // same domain, different container
	{ id: 15, url: 'https://evil-example.com/', index: 5, cookieStoreId: 'firefox-container-1' }, // same container, look-alike domain (not a real subdomain)
]

describe('ClearRuntimeImpl.clearDomain — matching tabs present', () => {
	let browserApi: BrowserApi

	beforeEach(() => {
		browserApi = makeBrowserApi()
		;(browserApi.tabs.query as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ cookieStoreId }: { cookieStoreId?: string }) => allTabsFixture.filter(t => t.cookieStoreId === cookieStoreId),
		)
	})

	it('queries tabs scoped to the tab-triggering container', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		expect(browserApi.tabs.query).toHaveBeenCalledWith({ cookieStoreId: 'firefox-container-1' })
	})

	it('closes every tab matching the base domain or a subdomain of it, and none of the non-matching tabs', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const removedIds = (browserApi.tabs.remove as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
		expect(removedIds).toEqual(expect.arrayContaining([10, 11, 12]))
		expect(removedIds).not.toContain(13) // unrelated domain, same container
		expect(removedIds).not.toContain(14) // same domain, different container (never returned by query)
		expect(removedIds).not.toContain(15) // look-alike domain, not an actual subdomain
	})

	it('closes all matched tabs before calling browsingData.remove', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const removeMock = browserApi.tabs.remove as ReturnType<typeof vi.fn>
		const browsingDataRemoveMock = browserApi.browsingData.remove as ReturnType<typeof vi.fn>

		expect(removeMock.mock.calls.length).toBeGreaterThan(0)
		expect(browsingDataRemoveMock).toHaveBeenCalledTimes(1)

		const lastTabRemoveOrder = Math.max(...removeMock.mock.invocationCallOrder)
		const browsingDataRemoveOrder = browsingDataRemoveMock.mock.invocationCallOrder[0]!

		expect(lastTabRemoveOrder).toBeLessThan(browsingDataRemoveOrder)
	})

	it('calls browsingData.remove exactly once with the distinct exact hostnames of matched tabs', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const browsingDataRemoveMock = browserApi.browsingData.remove as ReturnType<typeof vi.fn>
		expect(browsingDataRemoveMock).toHaveBeenCalledTimes(1)

		const [options, dataTypes] = browsingDataRemoveMock.mock.calls[0]! as [
			{ cookieStoreId?: string; hostnames?: string[] },
			{ cookies?: boolean; localStorage?: boolean; indexedDB?: boolean },
		]

		expect(options.cookieStoreId).toBe('firefox-container-1')
		// tabs 11 and 12 share hostname sub.example.com -> deduped to a single entry
		expect(options.hostnames!.slice().sort()).toEqual(['example.com', 'sub.example.com'])
		expect(dataTypes).toEqual({ cookies: true, localStorage: true, indexedDB: true })
	})

	it('does not include the base domain in hostnames unless it was itself an exact matched hostname', async () => {
		// Trigger from a bare-domain tab (no subdomain), so the only matched hostname is the base domain itself.
		const bareTab: Tab = { id: 2, url: 'https://example.com/other', index: 0, cookieStoreId: 'firefox-container-2', windowId: 1 }
		;(browserApi.tabs.query as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ cookieStoreId }: { cookieStoreId?: string }) => allTabsFixture.filter(t => t.cookieStoreId === cookieStoreId),
		)

		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(bareTab)

		const browsingDataRemoveMock = browserApi.browsingData.remove as ReturnType<typeof vi.fn>
		const [options] = browsingDataRemoveMock.mock.calls[0]! as [{ hostnames?: string[] }]
		// container-2 only has tab 14 (example.com) matching -> exact hostname list is just ['example.com']
		expect(options.hostnames).toEqual(['example.com'])
	})
})

describe('ClearRuntimeImpl.clearDomain — no matching tabs (fallback)', () => {
	let browserApi: BrowserApi

	beforeEach(() => {
		browserApi = makeBrowserApi()
		;(browserApi.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([])
	})

	it('does not call tabs.remove when nothing matched', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		expect(browserApi.tabs.remove).not.toHaveBeenCalled()
	})

	it('falls back to clearing the base domain itself via browsingData.remove', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const browsingDataRemoveMock = browserApi.browsingData.remove as ReturnType<typeof vi.fn>
		expect(browsingDataRemoveMock).toHaveBeenCalledTimes(1)
		expect(browsingDataRemoveMock).toHaveBeenCalledWith(
			{ cookieStoreId: 'firefox-container-1', hostnames: ['example.com'] },
			{ cookies: true, localStorage: true, indexedDB: true },
		)
	})
})
