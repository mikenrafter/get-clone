// ---- Browser API types ----

export interface ContextualIdentity {
	name: string
	cookieStoreId: string
	icon: string
	iconUrl?: string
	color: string
	colorCode?: string
}

export interface Tab {
	id?: number
	url?: string
	index: number
	title?: string
	cookieStoreId?: string
	windowId?: number
	status?: string
}

export interface MenusOnClickInfo {
	menuItemId: string
	parentMenuItemId?: string
}

export interface MenusOnShownInfo {
	contexts: string[]
	tabId?: number
}

export interface TabChangeInfo {
	status?: string
	url?: string
	cookieStoreId?: string
}

export interface ExtensionIcon {
	size: number
	url: string
}

export interface ExtensionInfo {
	id: string
	name: string
	enabled: boolean
	type: string
	icons?: ExtensionIcon[]
}

export interface MenusCreateDetails {
	id?: string
	title?: string
	contexts?: string[]
	parentId?: string
	type?: 'normal' | 'separator' | 'radio' | 'checkbox'
	checked?: boolean
	enabled?: boolean
	icons?: Record<number, string>
}

export interface ManagementApi {
	get(extensionId: string): Promise<ExtensionInfo>
}

export interface RuntimeApi {
	sendMessage(extensionId: string, message: Record<string, unknown>): Promise<unknown>
	getURL(path: string): string
}

export interface MenusApi {
	create(details: MenusCreateDetails): Promise<void>
	removeAll(): Promise<void>
	refresh(): Promise<void>
	onShown: {
		addListener(listener: (info: MenusOnShownInfo, tab?: Tab) => void | Promise<void>): void
	}
	onClicked: {
		addListener(listener: (info: MenusOnClickInfo, tab?: Tab) => void | Promise<void>): void
	}
}

export interface TabsApi {
	create(details: { cookieStoreId?: string; url?: string; index?: number; windowId?: number; active?: boolean }): Promise<Tab>
	get(tabId: number): Promise<Tab>
	discard(tabId: number): Promise<void>
	query(queryInfo: { cookieStoreId?: string }): Promise<Tab[]>
	remove(tabId: number): Promise<void>
	executeScript(tabId: number, details: { code: string }): Promise<unknown[]>
	onUpdated: {
		addListener(listener: (id: number, changeInfo: TabChangeInfo, tab: Tab) => void | Promise<void>): void
	}
}

export interface ContextualIdentitiesApi {
	query(details: Record<string, unknown>): Promise<ContextualIdentity[]>
	get(cookieStoreId: string): Promise<ContextualIdentity>
}

export interface Cookie {
	name: string
	value: string
	domain: string
	path: string
	secure: boolean
	httpOnly: boolean
	sameSite: 'no_restriction' | 'lax' | 'strict'
	expirationDate?: number
	storeId: string
}

export interface CookieSetDetails {
	url: string
	name: string
	value: string
	domain?: string
	path?: string
	secure?: boolean
	httpOnly?: boolean
	sameSite?: 'no_restriction' | 'lax' | 'strict'
	expirationDate?: number
	storeId: string
}

export interface CookiesApi {
	getAll(details: { storeId: string }): Promise<Cookie[]>
	set(details: CookieSetDetails): Promise<Cookie | null>
	remove(details: { url: string; name: string; storeId: string }): Promise<void>
}

export interface BrowserApi {
	menus: MenusApi
	tabs: TabsApi
	contextualIdentities: ContextualIdentitiesApi
	cookies: CookiesApi
	runtime: RuntimeApi
	management: ManagementApi
}

export interface LoggerLike {
	log: (...args: unknown[]) => void
}
