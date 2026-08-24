import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TcLayerImpl } from '../src/background/tcLayer'
import type { BrowserApi } from '../src/models'
import { TEMP_CONTAINERS_EXTENSION_IDS } from '../src/constants'

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
			onUpdated: { addListener: vi.fn() },
		},
		contextualIdentities: {
			query: vi.fn().mockResolvedValue([]),
			get: vi.fn(),
		},
		cookies: {
			getAll: vi.fn().mockResolvedValue([]),
			set: vi.fn().mockResolvedValue(null),
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

const [ID_STOICALLY, ID_GODKRATOS] = TEMP_CONTAINERS_EXTENSION_IDS

describe('TcLayerImpl', () => {
	let browserApi: BrowserApi

	beforeEach(() => {
		browserApi = makeBrowserApi()
	})

	it('isPresent() is false before initialize()', () => {
		const tcLayer = new TcLayerImpl({ browserApi })
		expect(tcLayer.isPresent()).toBe(false)
		expect(tcLayer.extensionId).toBeNull()
	})

	it('initialize() picks the first enabled id in TEMP_CONTAINERS_EXTENSION_IDS', async () => {
		;(browserApi.management.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
			if (id === ID_STOICALLY) {
				return { id, name: 'Temporary Containers', enabled: true, type: 'extension' }
			}
			throw new Error('not installed')
		})

		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		expect(tcLayer.isPresent()).toBe(true)
		expect(tcLayer.extensionId).toBe(ID_STOICALLY)
	})

	it('initialize() falls through to the second id when the first is not installed', async () => {
		;(browserApi.management.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
			if (id === ID_GODKRATOS) {
				return { id, name: 'Temporary Containers Plus', enabled: true, type: 'extension' }
			}
			throw new Error('not installed')
		})

		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		expect(tcLayer.isPresent()).toBe(true)
		expect(tcLayer.extensionId).toBe(ID_GODKRATOS)
	})

	it('initialize() skips an installed-but-disabled extension and keeps looking', async () => {
		;(browserApi.management.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
			if (id === ID_STOICALLY) {
				return { id, name: 'Temporary Containers', enabled: false, type: 'extension' }
			}
			if (id === ID_GODKRATOS) {
				return { id, name: 'Temporary Containers Plus', enabled: true, type: 'extension' }
			}
			throw new Error('not installed')
		})

		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		expect(tcLayer.isPresent()).toBe(true)
		expect(tcLayer.extensionId).toBe(ID_GODKRATOS)
	})

	it('initialize() leaves isPresent() false and extensionId null when every id rejects', async () => {
		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		expect(tcLayer.isPresent()).toBe(false)
		expect(tcLayer.extensionId).toBeNull()
	})

	it('isTempContainer() returns false without calling runtime.sendMessage when TC is not present', async () => {
		const tcLayer = new TcLayerImpl({ browserApi })

		const result = await tcLayer.isTempContainer('firefox-container-1')

		expect(result).toBe(false)
		expect(browserApi.runtime.sendMessage).not.toHaveBeenCalled()
	})

	it('isTempContainer() delegates to runtime.sendMessage and returns its boolean result when present', async () => {
		;(browserApi.management.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
			if (id === ID_STOICALLY) return { id, name: 'Temporary Containers', enabled: true, type: 'extension' }
			throw new Error('not installed')
		})
		;(browserApi.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(true)

		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		const result = await tcLayer.isTempContainer('firefox-tmp-1')

		expect(result).toBe(true)
		expect(browserApi.runtime.sendMessage).toHaveBeenCalledWith(ID_STOICALLY, {
			method: 'isTempContainer',
			cookieStoreId: 'firefox-tmp-1',
		})
	})

	it('createTempContainer() sends createTabInTempContainer and returns the resulting tab', async () => {
		;(browserApi.management.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
			if (id === ID_STOICALLY) return { id, name: 'Temporary Containers', enabled: true, type: 'extension' }
			throw new Error('not installed')
		})
		const newTab = { id: 50, index: 1, cookieStoreId: 'firefox-tmp-1' }
		;(browserApi.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(newTab)

		const tcLayer = new TcLayerImpl({ browserApi })
		await tcLayer.initialize()

		const result = await tcLayer.createTempContainer('https://example.com', 3, 7)

		expect(browserApi.runtime.sendMessage).toHaveBeenCalledWith(ID_STOICALLY, {
			method: 'createTabInTempContainer',
			url: 'https://example.com',
			active: true,
		})
		expect(result).toBe(newTab)
	})

	it('createTempContainer() throws when TC is not present', async () => {
		const tcLayer = new TcLayerImpl({ browserApi })

		await expect(tcLayer.createTempContainer('https://example.com', 3, 7)).rejects.toThrow()
		expect(browserApi.runtime.sendMessage).not.toHaveBeenCalled()
	})
})
