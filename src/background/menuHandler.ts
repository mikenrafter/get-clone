import type { BrowserApi, ContextualIdentity, MenusOnClickInfo, Tab } from '../models'
import type { TcLayer } from './tcLayer'
import type { CloneRuntime } from './cloneRuntime'
import type { ClearRuntime } from './clearRuntime'
import {
	MENU_PRIMARY,
	MENU_SECONDARY,
	MENU_CLEAR,
	MENU_RESTRICTED,
	NEW_TEMP_CONTAINER_SENTINEL,
	NO_CONTAINER,
	QUARANTINED_DOMAINS,
	PRIVILEGED_URL_SCHEMES,
} from '../constants'

export interface MenuHandlerDeps {
	readonly browserApi: BrowserApi
	readonly tcLayer: TcLayer
	readonly cloneRuntime: CloneRuntime
	readonly clearRuntime: ClearRuntime
}

export interface MenuHandler {
	buildMenus(tab: Tab): Promise<void>
	handleClick(info: MenusOnClickInfo, tab: Tab): Promise<void>
}

export class MenuHandlerImpl implements MenuHandler {
	constructor(private readonly deps: MenuHandlerDeps) {}

	async buildMenus(tab: Tab): Promise<void> {
		const { browserApi, tcLayer } = this.deps

		if (tab.url !== undefined && PRIVILEGED_URL_SCHEMES.some(scheme => tab.url!.startsWith(scheme))) {
			await browserApi.menus.removeAll()
			await browserApi.menus.refresh()
			return
		}

		if (tab.url !== undefined && QUARANTINED_DOMAINS.includes(new URL(tab.url).hostname as (typeof QUARANTINED_DOMAINS)[number])) {
			await browserApi.menus.removeAll()
			await browserApi.menus.create({
				id: MENU_RESTRICTED,
				title: "Get Clone is restricted here — enable 'Run on sites with restrictions' in about:addons",
				contexts: ['tab'],
			})
			await browserApi.menus.refresh()
			return
		}

		await browserApi.menus.removeAll()

		const containers = await browserApi.contextualIdentities.query({})
		const activeCookieStoreId = tab.cookieStoreId
		const isActiveNoContainer = activeCookieStoreId === undefined || activeCookieStoreId === NO_CONTAINER

		const permanentContainers: ContextualIdentity[] = []
		const temporaryContainers: ContextualIdentity[] = []

		for (const container of containers) {
			const isTemp = await tcLayer.isTempContainer(container.cookieStoreId)
			if (isTemp) {
				temporaryContainers.push(container)
			} else {
				permanentContainers.push(container)
			}
		}

		if (!tcLayer.isPresent()) {
			await browserApi.menus.create({ id: MENU_PRIMARY, title: 'Clone to Container', contexts: ['tab'] })
			await this.createNoContainerItem(isActiveNoContainer)
			for (const container of permanentContainers) {
				await this.createContainerItem(MENU_PRIMARY, container, MENU_PRIMARY, activeCookieStoreId)
			}
			await browserApi.menus.create({ id: MENU_CLEAR, parentId: MENU_PRIMARY, title: 'Clear Site Data for This Container', contexts: ['tab'] })
			await browserApi.menus.refresh()
			return
		}

		const activeIsTemporary = await tcLayer.isTempContainer(activeCookieStoreId ?? '')

		const primaryContainers = activeIsTemporary ? permanentContainers : temporaryContainers
		const secondaryContainers = activeIsTemporary ? temporaryContainers : permanentContainers
		const primaryTitle = activeIsTemporary ? 'Clone to Permanent Container' : 'Clone to Temporary Container'
		const secondaryTitle = activeIsTemporary ? 'Clone to Temporary Container' : 'Clone to Permanent Container'

		await browserApi.menus.create({ id: MENU_PRIMARY, title: primaryTitle, contexts: ['tab'] })

		await browserApi.menus.create({ id: MENU_SECONDARY, parentId: MENU_PRIMARY, title: secondaryTitle, contexts: ['tab'] })
		for (const container of secondaryContainers) {
			await this.createContainerItem(MENU_SECONDARY, container, MENU_SECONDARY, activeCookieStoreId)
		}

		await this.createNoContainerItem(isActiveNoContainer)

		for (const container of primaryContainers) {
			await this.createContainerItem(MENU_PRIMARY, container, MENU_PRIMARY, activeCookieStoreId)
		}
		await browserApi.menus.create({
			id: `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`,
			parentId: MENU_PRIMARY,
			title: 'New Temporary Container',
			icons: { 16: 'icons/temp-container.svg' },
			contexts: ['tab'],
		})

		await browserApi.menus.create({ id: MENU_CLEAR, parentId: MENU_PRIMARY, title: 'Clear Site Data for This Container', contexts: ['tab'] })

		await browserApi.menus.refresh()
	}

	async handleClick(info: MenusOnClickInfo, tab: Tab): Promise<void> {
		const { cloneRuntime, clearRuntime, browserApi } = this.deps

		const menuItemId = String(info.menuItemId)

		if (menuItemId === MENU_CLEAR) {
			await clearRuntime.clearDomain(tab)
			return
		}

		if (menuItemId === MENU_RESTRICTED) {
			const hostname = tab.url !== undefined ? new URL(tab.url).hostname : ''
			const infoUrl = browserApi.runtime.getURL(`info/restricted-site.html?domain=${encodeURIComponent(hostname)}`)
			await browserApi.tabs.create({ url: infoUrl })
			return
		}

		let remainder: string
		if (menuItemId.startsWith(`${MENU_PRIMARY}-`)) {
			remainder = menuItemId.slice(`${MENU_PRIMARY}-`.length)
		} else if (menuItemId.startsWith(`${MENU_SECONDARY}-`)) {
			remainder = menuItemId.slice(`${MENU_SECONDARY}-`.length)
		} else {
			return
		}

		if (remainder === NEW_TEMP_CONTAINER_SENTINEL) {
			await cloneRuntime.cloneToTemporary(tab)
		} else {
			await cloneRuntime.cloneToContainer(tab, remainder)
		}
	}

	private async createContainerItem(
		prefix: string,
		container: ContextualIdentity,
		parentId: string | undefined,
		activeCookieStoreId: string | undefined,
	): Promise<void> {
		const isActive = container.cookieStoreId === activeCookieStoreId
		await this.deps.browserApi.menus.create({
			id: `${prefix}-${container.cookieStoreId}`,
			...(parentId !== undefined ? { parentId } : {}),
			title: container.name,
			icons: { 16: `icons/${container.icon}.svg#${container.color}` },
			contexts: ['tab'],
			...(isActive ? { enabled: false } : {}),
		})
	}

	private async createNoContainerItem(isActiveNoContainer: boolean): Promise<void> {
		await this.deps.browserApi.menus.create({
			id: `${MENU_PRIMARY}-${NO_CONTAINER}`,
			parentId: MENU_PRIMARY,
			title: 'No Container',
			contexts: ['tab'],
			...(isActiveNoContainer ? { enabled: false } : {}),
		})
	}
}
