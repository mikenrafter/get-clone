import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CloneRuntimeImpl } from '../src/background/cloneRuntime'
import type { BrowserApi, Cookie, Tab } from '../src/models'
import type { TcLayer } from '../src/background/tcLayer'

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
			create: vi.fn().mockResolvedValue({ id: 99, index: 1, cookieStoreId: 'firefox-container-2' }),
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

function makeTcLayer(): TcLayer {
	return {
		extensionId: '{c607c8df-14a7-4f28-894f-29e8722976af}',
		isPresent: vi.fn().mockReturnValue(true),
		initialize: vi.fn().mockResolvedValue(undefined),
		isTempContainer: vi.fn().mockResolvedValue(false),
		createTempContainer: vi.fn().mockResolvedValue({ id: 50, index: 1, cookieStoreId: 'firefox-tmp-1' }),
	}
}

const sourceCookie: Cookie = {
	name: 'session',
	value: 'abc123',
	domain: 'example.com',
	path: '/',
	secure: true,
	httpOnly: true,
	sameSite: 'lax',
	expirationDate: 1893456000,
	storeId: 'firefox-container-1',
}

const sourceTab: Tab = {
	id: 1,
	url: 'https://example.com/page',
	index: 0,
	cookieStoreId: 'firefox-container-1',
	windowId: 1,
}

function getRegisteredOnUpdatedListener(browserApi: BrowserApi) {
	const addListener = browserApi.tabs.onUpdated.addListener as ReturnType<typeof vi.fn>
	expect(addListener).toHaveBeenCalled()
	return addListener.mock.calls[addListener.mock.calls.length - 1]![0] as (
		id: number,
		changeInfo: { status?: string },
		tab: Tab,
	) => void | Promise<void>
}

describe('CloneRuntimeImpl.cloneToContainer', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer()
		;(browserApi.cookies.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([sourceCookie])
	})

	it('reads cookies via cookies.getAll scoped to the source cookieStoreId', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		expect(browserApi.cookies.getAll).toHaveBeenCalledWith({ storeId: 'firefox-container-1' })
	})

	it('re-sets each cookie verbatim into the target store', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		expect(browserApi.cookies.set).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'session',
				value: 'abc123',
				domain: 'example.com',
				path: '/',
				secure: true,
				httpOnly: true,
				sameSite: 'lax',
				expirationDate: 1893456000,
				storeId: 'firefox-container-2',
			}),
		)
	})

	it('creates the new tab with cookieStoreId present in the very first tabs.create call', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		expect(browserApi.tabs.create).toHaveBeenCalledTimes(1)
		expect(browserApi.tabs.create).toHaveBeenNthCalledWith(1, {
			cookieStoreId: 'firefox-container-2',
			url: sourceTab.url,
			index: sourceTab.index + 1,
		})
	})

	it('discards the source tab once the new tab finishes loading (status complete, matching id)', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(99, { status: 'complete' }, { id: 99, index: 1, cookieStoreId: 'firefox-container-2' })

		expect(browserApi.tabs.discard).toHaveBeenCalledWith(sourceTab.id)
		expect(browserApi.tabs.discard).not.toHaveBeenCalledWith(99)
	})

	it('does not discard for updates to an unrelated tab id', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(12345, { status: 'complete' }, { id: 12345, index: 3 })

		expect(browserApi.tabs.discard).not.toHaveBeenCalled()
	})

	it('does not discard while the new tab is still loading', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(99, { status: 'loading' }, { id: 99, index: 1, cookieStoreId: 'firefox-container-2' })

		expect(browserApi.tabs.discard).not.toHaveBeenCalled()
	})

	it('never calls tabs.remove or tabs.update on the source tab (discard-only)', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToContainer(sourceTab, 'firefox-container-2')

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(99, { status: 'complete' }, { id: 99, index: 1, cookieStoreId: 'firefox-container-2' })

		// tabs.remove now exists on TabsApi (needed by clearRuntime's clear-domain-data flow),
		// so the guardrail here is behavioral: the clone flow itself must never call it.
		expect(browserApi.tabs.remove).not.toHaveBeenCalled()
		expect('update' in browserApi.tabs).toBe(false)
		expect(browserApi.tabs.discard).toHaveBeenCalledTimes(1)
		expect(browserApi.tabs.discard).toHaveBeenCalledWith(sourceTab.id)
	})
})

describe('CloneRuntimeImpl.cloneToTemporary', () => {
	let browserApi: BrowserApi
	let tcLayer: TcLayer
	let callOrder: string[]

	beforeEach(() => {
		browserApi = makeBrowserApi()
		tcLayer = makeTcLayer()
		callOrder = []
		;(tcLayer.createTempContainer as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callOrder.push('createTempContainer')
			return { id: 50, index: 1, cookieStoreId: 'firefox-tmp-1' }
		})
		;(browserApi.cookies.getAll as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callOrder.push('cookies.getAll')
			return [sourceCookie]
		})
		;(browserApi.cookies.set as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callOrder.push('cookies.set')
			return null
		})
	})

	it('creates the temp container tab via tcLayer with the source url/index/windowId', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToTemporary(sourceTab)

		expect(tcLayer.createTempContainer).toHaveBeenCalledWith(
			sourceTab.url,
			sourceTab.index + 1,
			sourceTab.windowId,
		)
	})

	it('copies cookies from the source store into the new temp container store, in order after tab creation', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToTemporary(sourceTab)

		expect(browserApi.cookies.getAll).toHaveBeenCalledWith({ storeId: 'firefox-container-1' })
		expect(browserApi.cookies.set).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'session',
				value: 'abc123',
				domain: 'example.com',
				path: '/',
				secure: true,
				httpOnly: true,
				sameSite: 'lax',
				expirationDate: 1893456000,
				storeId: 'firefox-tmp-1',
			}),
		)
		expect(callOrder).toEqual(['createTempContainer', 'cookies.getAll', 'cookies.set'])
	})

	it('discards the source tab once the new temp container tab finishes loading', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToTemporary(sourceTab)

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(50, { status: 'complete' }, { id: 50, index: 1, cookieStoreId: 'firefox-tmp-1' })

		expect(browserApi.tabs.discard).toHaveBeenCalledWith(sourceTab.id)
	})

	it('does not discard for updates to an unrelated tab id', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToTemporary(sourceTab)

		const listener = getRegisteredOnUpdatedListener(browserApi)
		await listener(777, { status: 'complete' }, { id: 777, index: 4 })

		expect(browserApi.tabs.discard).not.toHaveBeenCalled()
	})

	it('does not call tabs.create directly — the new tab comes from tcLayer', async () => {
		const runtime = new CloneRuntimeImpl({ browserApi, tcLayer })
		await runtime.cloneToTemporary(sourceTab)

		expect(browserApi.tabs.create).not.toHaveBeenCalled()
	})
})
