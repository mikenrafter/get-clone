import type { BrowserApi, Tab } from '../models'
import { TEMP_CONTAINERS_EXTENSION_IDS } from '../constants'

export interface TcLayerDeps {
	readonly browserApi: BrowserApi
}

export interface TcLayer {
	readonly extensionId: string | null
	isPresent(): boolean
	initialize(): Promise<void>
	isTempContainer(cookieStoreId: string): Promise<boolean>
	createTempContainer(url: string, index: number, windowId: number): Promise<Tab>
}

export class TcLayerImpl implements TcLayer {
	private readonly browserApi: BrowserApi
	private _extensionId: string | null = null

	constructor(deps: TcLayerDeps) {
		this.browserApi = deps.browserApi
	}

	get extensionId(): string | null {
		return this._extensionId
	}

	isPresent(): boolean {
		return this._extensionId !== null
	}

	async initialize(): Promise<void> {
		for (const extensionId of TEMP_CONTAINERS_EXTENSION_IDS) {
			try {
				const extensionInfo = await this.browserApi.management.get(extensionId)
				if (extensionInfo.enabled) {
					this._extensionId = extensionId
					return
				}
			} catch {
				// Extension not installed — try next
			}
		}
		this._extensionId = null
	}

	async isTempContainer(cookieStoreId: string): Promise<boolean> {
		if (!this._extensionId) return false
		return (await this.browserApi.runtime.sendMessage(this._extensionId, {
			method: 'isTempContainer',
			cookieStoreId,
		})) as boolean
	}

	async createTempContainer(url: string, _index: number, _windowId: number): Promise<Tab> {
		if (!this._extensionId) throw new Error('No Temporary Containers extension detected')
		return (await this.browserApi.runtime.sendMessage(this._extensionId, {
			method: 'createTabInTempContainer',
			url,
			active: true,
		})) as Tab
	}
}
