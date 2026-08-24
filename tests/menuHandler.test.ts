import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MenuHandlerImpl } from '../src/background/menuHandler'
import type { BrowserApi, ContextualIdentity, Tab } from '../src/models'
import type { TcLayer } from '../src/background/tcLayer'
import type { CloneRuntime } from '../src/background/cloneRuntime'
import type { ClearRuntime } from '../src/background/clearRuntime'
import {
	MENU_PRIMARY,
	MENU_SECONDARY,
	MENU_CLEAR,
	MENU_RESTRICTED,
	NEW_TEMP_CONTAINER_SENTINEL,
} from '../src/constants'

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
			create: vi.fn().mockResolvedValue({ id: 99, index: 0 }),
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
		browsingData: {
			remove: vi.fn().mockResolvedValue(undefined),
		},
	}
}

function makeTcLayer(present: boolean): TcLayer {
	return {
		extensionId: present ? '{c607c8df-14a7-4f28-894f-29e8722976af}' : null,
		isPresent: vi.fn().mockReturnValue(present),
		initialize: vi.fn().mockResolvedValue(undefined),
		isTempContainer: vi.fn(async (cookieStoreId: string) => cookieStoreId.startsWith('firefox-tmp-')),
		createTempContainer: vi.fn().mockResolvedValue({ id: 50, index: 1, cookieStoreId: 'firefox-tmp-new' }),
	}
}

function makeCloneRuntime(): CloneRuntime {
	return {
		cloneToContainer: vi.fn().mockResolvedValue(undefined),
		cloneToTemporary: vi.fn().mockResolvedValue(undefined),
	}
}

function makeClearRuntime(): ClearRuntime {
	return {
		clearDomain: vi.fn().mockResolvedValue(undefined),
	}
}

const allContainers: ContextualIdentity[] = [
	{ name: 'Work', cookieStoreId: 'firefox-container-1', icon: 'briefcase', color: 'blue' },
	{ name: 'Personal', cookieStoreId: 'firefox-container-2', icon: 'fingerprint', color: 'green' },
	{ name: 'Temp A', cookieStoreId: 'firefox-tmp-1', icon: 'circle', color: 'red' },
	{ name: 'Temp B', cookieStoreId: 'firefox-tmp-2', icon: 'circle', color: 'orange' },
]

type CreateArgs = { id?: string; parentId?: string; type?: string; icons?: Record<number, string>; title?: string; contexts?: string[] }

function createCallsOf(browserApi: BrowserApi): CreateArgs[] {
	return (browserApi.menus.create as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as CreateArgs)
}

function idsWithPrefix(calls: CreateArgs[], prefix: string): string[] {
	return calls
		.map(c => c.id)
		.filter((id): id is string => !!id && id.startsWith(`${prefix}-`))
		.map(id => id.slice(`${prefix}-`.length))
}

// ---------------------------------------------------------------------------
// TC not installed — flat permanent-only menu
// ---------------------------------------------------------------------------

describe('MenuHandlerImpl.buildMenus — TC not present', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let cloneRuntime: CloneRuntime
	let clearRuntime: ClearRuntime

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer(false)
		cloneRuntime = makeCloneRuntime()
		clearRuntime = makeClearRuntime()
		;(browserApi.contextualIdentities.query as ReturnType<typeof vi.fn>).mockResolvedValue(allContainers)
	})

	it('builds a flat menu containing only permanent containers', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const primaryIds = idsWithPrefix(calls, MENU_PRIMARY)
		// active tab's own container is excluded
		expect(primaryIds.sort()).toEqual(['firefox-container-2'])
	})

	it('does not create a sentinel item', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const sentinel = calls.find(c => c.id === `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`)
		expect(sentinel).toBeUndefined()
	})

	it('does not create any secondary-prefixed items', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const secondaryItems = calls.filter(c => c.id?.startsWith(`${MENU_SECONDARY}-`))
		expect(secondaryItems).toHaveLength(0)
	})

	it('permanent container items carry their bundled icon', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const item = calls.find(c => c.id === `${MENU_PRIMARY}-firefox-container-2`)
		expect(item).toBeDefined()
		expect(item!.icons).toEqual({ 16: 'icons/fingerprint.svg#green' })
	})

	it('calls menus.refresh() after rebuilding so an already-open menu picks up the new items', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		expect(browserApi.menus.refresh).toHaveBeenCalledTimes(1)
	})

	it('still creates a top-level MENU_CLEAR item even though TC is absent', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const clearItem = calls.find(c => c.id === MENU_CLEAR)
		expect(clearItem).toBeDefined()
		expect(clearItem!.parentId).toBeUndefined()
		expect(clearItem!.contexts).toEqual(['tab'])
	})
})

// ---------------------------------------------------------------------------
// TC present — active tab is in a temporary container
// ---------------------------------------------------------------------------

describe('MenuHandlerImpl.buildMenus — TC present, active tab in a temporary container', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let cloneRuntime: CloneRuntime
	let clearRuntime: ClearRuntime
	const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-tmp-1', windowId: 1 }

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer(true)
		cloneRuntime = makeCloneRuntime()
		clearRuntime = makeClearRuntime()
		;(browserApi.contextualIdentities.query as ReturnType<typeof vi.fn>).mockResolvedValue(allContainers)
	})

	it('primary submenu holds permanent containers plus the sentinel', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const primaryIds = idsWithPrefix(calls, MENU_PRIMARY).sort()
		expect(primaryIds).toEqual(['firefox-container-1', 'firefox-container-2', NEW_TEMP_CONTAINER_SENTINEL].sort())
	})

	it('secondary submenu holds the other existing temporary containers, excluding the active one', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const secondaryIds = idsWithPrefix(calls, MENU_SECONDARY).sort()
		expect(secondaryIds).toEqual(['firefox-tmp-2'])
	})

	it('sentinel item has the temp-container icon', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const sentinel = calls.find(c => c.id === `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`)
		expect(sentinel).toBeDefined()
		expect(sentinel!.icons).toEqual({ 16: 'icons/temp-container.svg' })
	})

	it('sentinel item is parented under the primary submenu', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const sentinel = calls.find(c => c.id === `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`)
		expect(sentinel!.parentId).toBe(MENU_PRIMARY)
	})

	it('existing temporary container item in secondary carries its own bundled icon', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const item = calls.find(c => c.id === `${MENU_SECONDARY}-firefox-tmp-2`)
		expect(item).toBeDefined()
		expect(item!.icons).toEqual({ 16: 'icons/circle.svg#orange' })
	})

	it('the MENU_SECONDARY header item itself is nested under MENU_PRIMARY, not top-level', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const secondaryHeader = calls.find(c => c.id === MENU_SECONDARY)
		expect(secondaryHeader).toBeDefined()
		expect(secondaryHeader!.parentId).toBe(MENU_PRIMARY)
	})

	it('creates the MENU_SECONDARY header before the flat primary-container children', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const createMock = browserApi.menus.create as ReturnType<typeof vi.fn>
		const secondaryHeaderCallIndex = createMock.mock.calls.findIndex(c => (c[0] as CreateArgs).id === MENU_SECONDARY)
		const firstFlatPrimaryChildIndex = createMock.mock.calls.findIndex(
			c => (c[0] as CreateArgs).id === `${MENU_PRIMARY}-firefox-container-1` || (c[0] as CreateArgs).id === `${MENU_PRIMARY}-firefox-container-2`,
		)

		expect(secondaryHeaderCallIndex).toBeGreaterThanOrEqual(0)
		expect(firstFlatPrimaryChildIndex).toBeGreaterThanOrEqual(0)
		expect(secondaryHeaderCallIndex).toBeLessThan(firstFlatPrimaryChildIndex)
	})

	it('also creates a top-level MENU_CLEAR item', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const clearItem = calls.find(c => c.id === MENU_CLEAR)
		expect(clearItem).toBeDefined()
		expect(clearItem!.parentId).toBeUndefined()
		expect(clearItem!.contexts).toEqual(['tab'])
	})
})

// ---------------------------------------------------------------------------
// TC present — active tab is in a permanent container (or no container)
// ---------------------------------------------------------------------------

describe('MenuHandlerImpl.buildMenus — TC present, active tab in a permanent container', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let cloneRuntime: CloneRuntime
	let clearRuntime: ClearRuntime
	const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer(true)
		cloneRuntime = makeCloneRuntime()
		clearRuntime = makeClearRuntime()
		;(browserApi.contextualIdentities.query as ReturnType<typeof vi.fn>).mockResolvedValue(allContainers)
	})

	it('primary submenu holds existing temporary containers plus the sentinel', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const primaryIds = idsWithPrefix(calls, MENU_PRIMARY).sort()
		expect(primaryIds).toEqual(['firefox-tmp-1', 'firefox-tmp-2', NEW_TEMP_CONTAINER_SENTINEL].sort())
	})

	it('secondary submenu holds the other permanent containers, excluding the active one', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const secondaryIds = idsWithPrefix(calls, MENU_SECONDARY).sort()
		expect(secondaryIds).toEqual(['firefox-container-2'])
	})

	it('sentinel stays pinned in primary even though primary now holds temporary containers', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const sentinel = calls.find(c => c.id === `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`)
		expect(sentinel).toBeDefined()
		expect(sentinel!.parentId).toBe(MENU_PRIMARY)
		const secondarySentinel = calls.find(c => c.id === `${MENU_SECONDARY}-${NEW_TEMP_CONTAINER_SENTINEL}`)
		expect(secondarySentinel).toBeUndefined()
	})

	it('permanent container item in secondary carries its own bundled icon', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const item = calls.find(c => c.id === `${MENU_SECONDARY}-firefox-container-2`)
		expect(item).toBeDefined()
		expect(item!.icons).toEqual({ 16: 'icons/fingerprint.svg#green' })
	})

	it('the MENU_SECONDARY header item itself is nested under MENU_PRIMARY, not top-level', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const secondaryHeader = calls.find(c => c.id === MENU_SECONDARY)
		expect(secondaryHeader).toBeDefined()
		expect(secondaryHeader!.parentId).toBe(MENU_PRIMARY)
	})

	it('treats a tab with no cookieStoreId the same as a permanent-container tab', async () => {
		const noContainerTab: Tab = { id: 1, url: 'https://example.com', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(noContainerTab)

		const calls = createCallsOf(browserApi)
		const primaryIds = idsWithPrefix(calls, MENU_PRIMARY).sort()
		expect(primaryIds).toEqual(['firefox-tmp-1', 'firefox-tmp-2', NEW_TEMP_CONTAINER_SENTINEL].sort())
		const secondaryIds = idsWithPrefix(calls, MENU_SECONDARY).sort()
		expect(secondaryIds).toEqual(['firefox-container-1', 'firefox-container-2'].sort())
	})

	it('also creates a top-level MENU_CLEAR item', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const clearItem = calls.find(c => c.id === MENU_CLEAR)
		expect(clearItem).toBeDefined()
		expect(clearItem!.parentId).toBeUndefined()
		expect(clearItem!.contexts).toEqual(['tab'])
	})
})

// ---------------------------------------------------------------------------
// Restricted-site gating — checked before any other menu build logic
// ---------------------------------------------------------------------------

describe('MenuHandlerImpl.buildMenus — restricted-site gating', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let cloneRuntime: CloneRuntime
	let clearRuntime: ClearRuntime

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer(true)
		cloneRuntime = makeCloneRuntime()
		clearRuntime = makeClearRuntime()
		;(browserApi.contextualIdentities.query as ReturnType<typeof vi.fn>).mockResolvedValue(allContainers)
	})

	it('creates no items at all on a privileged about: page, but does removeAll + refresh', async () => {
		const tab: Tab = { id: 1, url: 'about:preferences', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		expect(browserApi.menus.create).not.toHaveBeenCalled()
		expect(browserApi.menus.removeAll).toHaveBeenCalledTimes(1)
		expect(browserApi.menus.refresh).toHaveBeenCalledTimes(1)
	})

	it('creates no items at all on a privileged moz-extension: page', async () => {
		const tab: Tab = { id: 1, url: 'moz-extension://abc-123/settings.html', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		expect(browserApi.menus.create).not.toHaveBeenCalled()
		expect(browserApi.menus.removeAll).toHaveBeenCalledTimes(1)
		expect(browserApi.menus.refresh).toHaveBeenCalledTimes(1)
	})

	it('does not bother querying containers for a privileged page', async () => {
		const tab: Tab = { id: 1, url: 'about:preferences', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		expect(browserApi.contextualIdentities.query).not.toHaveBeenCalled()
	})

	it('creates only MENU_RESTRICTED on a quarantined domain', async () => {
		const tab: Tab = { id: 1, url: 'https://addons.mozilla.org/en-US/firefox/', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		expect(calls).toHaveLength(1)
		expect(calls[0]!.id).toBe(MENU_RESTRICTED)
	})

	it('MENU_RESTRICTED item has tab context and an explanatory title mentioning the restriction', async () => {
		const tab: Tab = { id: 1, url: 'https://addons.mozilla.org/en-US/firefox/', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		const restricted = calls.find(c => c.id === MENU_RESTRICTED)
		expect(restricted).toBeDefined()
		expect(restricted!.contexts).toEqual(['tab'])
		expect(restricted!.title).toBeDefined()
		expect(restricted!.title!.toLowerCase()).toContain('restrict')
	})

	it('calls removeAll + refresh (and no create beyond MENU_RESTRICTED) for every quarantined domain', async () => {
		const quarantinedUrls = [
			'https://accounts.firefox.com/signin',
			'https://support.mozilla.org/en-US/',
			'https://sync.services.mozilla.com/',
		]

		for (const url of quarantinedUrls) {
			browserApi = makeBrowserApi()
			;(browserApi.contextualIdentities.query as ReturnType<typeof vi.fn>).mockResolvedValue(allContainers)
			const tab: Tab = { id: 1, url, index: 0, windowId: 1 }
			const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
			await handler.buildMenus(tab)

			const calls = createCallsOf(browserApi)
			expect(calls).toHaveLength(1)
			expect(calls[0]!.id).toBe(MENU_RESTRICTED)
			expect(browserApi.menus.removeAll).toHaveBeenCalledTimes(1)
			expect(browserApi.menus.refresh).toHaveBeenCalledTimes(1)
		}
	})

	it('does not bother querying containers for a quarantined domain', async () => {
		const tab: Tab = { id: 1, url: 'https://addons.mozilla.org/en-US/firefox/', index: 0, windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		expect(browserApi.contextualIdentities.query).not.toHaveBeenCalled()
	})

	it('still builds the normal menu (MENU_PRIMARY + MENU_CLEAR) for an ordinary https site', async () => {
		const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.buildMenus(tab)

		const calls = createCallsOf(browserApi)
		expect(calls.find(c => c.id === MENU_PRIMARY)).toBeDefined()
		expect(calls.find(c => c.id === MENU_CLEAR)).toBeDefined()
		expect(calls.find(c => c.id === MENU_RESTRICTED)).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// handleClick
// ---------------------------------------------------------------------------

describe('MenuHandlerImpl.handleClick', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let cloneRuntime: CloneRuntime
	let clearRuntime: ClearRuntime
	const tab: Tab = { id: 1, url: 'https://example.com', index: 0, cookieStoreId: 'firefox-container-1', windowId: 1 }

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer(true)
		cloneRuntime = makeCloneRuntime()
		clearRuntime = makeClearRuntime()
	})

	it('dispatches to cloneRuntime.cloneToContainer for a primary container item', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.handleClick({ menuItemId: `${MENU_PRIMARY}-firefox-tmp-1` }, tab)

		expect(cloneRuntime.cloneToContainer).toHaveBeenCalledWith(tab, 'firefox-tmp-1')
		expect(cloneRuntime.cloneToTemporary).not.toHaveBeenCalled()
	})

	it('dispatches to cloneRuntime.cloneToContainer for a secondary container item', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.handleClick({ menuItemId: `${MENU_SECONDARY}-firefox-container-2` }, tab)

		expect(cloneRuntime.cloneToContainer).toHaveBeenCalledWith(tab, 'firefox-container-2')
		expect(cloneRuntime.cloneToTemporary).not.toHaveBeenCalled()
	})

	it('dispatches to cloneRuntime.cloneToTemporary for the sentinel item', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.handleClick({ menuItemId: `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}` }, tab)

		expect(cloneRuntime.cloneToTemporary).toHaveBeenCalledWith(tab)
		expect(cloneRuntime.cloneToContainer).not.toHaveBeenCalled()
	})

	it('dispatches MENU_CLEAR clicks to clearRuntime.clearDomain', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.handleClick({ menuItemId: MENU_CLEAR }, tab)

		expect(clearRuntime.clearDomain).toHaveBeenCalledWith(tab)
		expect(cloneRuntime.cloneToContainer).not.toHaveBeenCalled()
		expect(cloneRuntime.cloneToTemporary).not.toHaveBeenCalled()
	})

	it('dispatches MENU_RESTRICTED clicks to open about:addons in a new tab', async () => {
		const handler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })
		await handler.handleClick({ menuItemId: MENU_RESTRICTED }, tab)

		expect(browserApi.tabs.create).toHaveBeenCalledWith({ url: 'about:addons' })
		expect(clearRuntime.clearDomain).not.toHaveBeenCalled()
	})
})
