import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClearRuntimeImpl, getBaseDomain } from '../src/background/clearRuntime'
import type { BrowserApi, Cookie, Tab } from '../src/models'

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

const allCookiesFixture: Cookie[] = [
	{ name: 'a', value: '1', domain: 'example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', storeId: 'firefox-container-1' }, // exact match
	{ name: 'b', value: '2', domain: '.sub.example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', storeId: 'firefox-container-1' }, // leading-dot subdomain match
	{ name: 'c', value: '3', domain: 'unrelated.org', path: '/', secure: true, httpOnly: false, sameSite: 'lax', storeId: 'firefox-container-1' }, // unrelated domain
	{ name: 'd', value: '4', domain: 'example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', storeId: 'firefox-container-2' }, // different container
	{ name: 'e', value: '5', domain: 'evil-example.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', storeId: 'firefox-container-1' }, // look-alike domain, same container
]

describe('ClearRuntimeImpl.clearDomain', () => {
	let browserApi: BrowserApi
	let nextCreatedTabId: number

	beforeEach(() => {
		browserApi = makeBrowserApi()
		nextCreatedTabId = 200
		;(browserApi.tabs.query as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ cookieStoreId }: { cookieStoreId?: string }) => allTabsFixture.filter(t => t.cookieStoreId === cookieStoreId),
		)
		;(browserApi.cookies.getAll as ReturnType<typeof vi.fn>).mockImplementation(
			async ({ storeId }: { storeId: string }) => allCookiesFixture.filter(c => c.storeId === storeId),
		)
		;(browserApi.tabs.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			const id = nextCreatedTabId++
			return { id, index: 0 }
		})
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

	it('closes matched tabs before clearing any cookies and before spinning up any storage-clearing tab', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const removeMock = browserApi.tabs.remove as ReturnType<typeof vi.fn>
		const matchedTabIds = [10, 11, 12]
		const matchedCloseOrders = removeMock.mock.calls
			.map((args, idx) => ({ tabId: args[0] as number, order: removeMock.mock.invocationCallOrder[idx]! }))
			.filter(c => matchedTabIds.includes(c.tabId))
			.map(c => c.order)

		expect(matchedCloseOrders).toHaveLength(3)
		const lastMatchedCloseOrder = Math.max(...matchedCloseOrders)

		const cookiesRemoveMock = browserApi.cookies.remove as ReturnType<typeof vi.fn>
		expect(cookiesRemoveMock.mock.calls.length).toBeGreaterThan(0)
		const firstCookieRemoveOrder = cookiesRemoveMock.mock.invocationCallOrder[0]!

		const createMock = browserApi.tabs.create as ReturnType<typeof vi.fn>
		expect(createMock.mock.calls.length).toBeGreaterThan(0)
		const firstStorageCreateOrder = createMock.mock.invocationCallOrder[0]!

		expect(lastMatchedCloseOrder).toBeLessThan(firstCookieRemoveOrder)
		expect(lastMatchedCloseOrder).toBeLessThan(firstStorageCreateOrder)
	})

	it('clears only cookies whose domain matches the base domain or a subdomain of it', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const removedCookieNames = (browserApi.cookies.remove as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as { name: string }).name)
		expect(removedCookieNames.sort()).toEqual(['a', 'b'])
	})

	it('builds the cookie removal url the same way cloneRuntime does (scheme by secure flag, domain, path)', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const calls = (browserApi.cookies.remove as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as { url: string; name: string; storeId: string })
		const cookieA = calls.find(c => c.name === 'a')
		const cookieB = calls.find(c => c.name === 'b')

		expect(cookieA).toEqual({ url: 'https://example.com/', name: 'a', storeId: 'firefox-container-1' })
		expect(cookieB).toEqual({ url: 'http://sub.example.com/', name: 'b', storeId: 'firefox-container-1' })
	})

	it('spins up exactly one storage-clearing tab per distinct matched hostname, deduping tabs that share an origin', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		// tabs 11 and 12 share the hostname sub.example.com, so this must collapse to a single cycle for it,
		// alongside a single cycle for example.com (from tab 10) -> two cycles total, not three.
		expect(browserApi.tabs.create).toHaveBeenCalledTimes(2)

		const createCalls = (browserApi.tabs.create as ReturnType<typeof vi.fn>).mock.calls.map(
			c => c[0] as { cookieStoreId?: string; url?: string; active?: boolean },
		)
		expect(createCalls).toEqual(
			expect.arrayContaining([
				{ cookieStoreId: 'firefox-container-1', url: 'https://example.com', active: false },
				{ cookieStoreId: 'firefox-container-1', url: 'https://sub.example.com', active: false },
			]),
		)
	})

	it('runs executeScript against each created storage-clearing tab, then removes it', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const createdIds = [200, 201]

		for (const id of createdIds) {
			const executeScriptCall = (browserApi.tabs.executeScript as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === id)
			expect(executeScriptCall).toBeDefined()
			const details = executeScriptCall![1] as { code: string }
			expect(typeof details.code).toBe('string')
			expect(details.code.toLowerCase()).toContain('localstorage')
			expect(details.code.toLowerCase()).toContain('sessionstorage')
			expect(details.code.toLowerCase()).toContain('indexeddb')

			const removeCall = (browserApi.tabs.remove as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === id)
			expect(removeCall).toBeDefined()
		}
	})

	it('executes the storage-clearing script before removing the scratch tab, for each hostname', async () => {
		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		const executeScriptMock = browserApi.tabs.executeScript as ReturnType<typeof vi.fn>
		const removeMock = browserApi.tabs.remove as ReturnType<typeof vi.fn>

		for (const id of [200, 201]) {
			const execIdx = executeScriptMock.mock.calls.findIndex(c => c[0] === id)
			const removeIdx = removeMock.mock.calls.findIndex(c => c[0] === id)
			expect(execIdx).toBeGreaterThanOrEqual(0)
			expect(removeIdx).toBeGreaterThanOrEqual(0)
			const execOrder = executeScriptMock.mock.invocationCallOrder[execIdx]!
			const removeOrder = removeMock.mock.invocationCallOrder[removeIdx]!
			expect(execOrder).toBeLessThan(removeOrder)
		}
	})

	it('does nothing beyond the domain computation when no tabs or cookies match', async () => {
		;(browserApi.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([])
		;(browserApi.cookies.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])

		const runtime = new ClearRuntimeImpl({ browserApi })
		await runtime.clearDomain(sourceTab)

		expect(browserApi.tabs.remove).not.toHaveBeenCalled()
		expect(browserApi.cookies.remove).not.toHaveBeenCalled()
		expect(browserApi.tabs.create).not.toHaveBeenCalled()
		expect(browserApi.tabs.executeScript).not.toHaveBeenCalled()
	})
})
