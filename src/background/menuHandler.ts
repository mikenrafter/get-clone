import type { BrowserApi, ContextualIdentity, MenusOnClickInfo, Tab } from '../models'
import type { TcLayer } from './tcLayer'
import type { CloneRuntime } from './cloneRuntime'
import { MENU_PRIMARY, MENU_SECONDARY, NEW_TEMP_CONTAINER_SENTINEL } from '../constants'

export interface MenuHandlerDeps {
	readonly browserApi: BrowserApi
	readonly tcLayer: TcLayer
	readonly cloneRuntime: CloneRuntime
}

export interface MenuHandler {
	buildMenus(tab: Tab): Promise<void>
	handleClick(info: MenusOnClickInfo, tab: Tab): Promise<void>
}

export class MenuHandlerImpl implements MenuHandler {
	constructor(private readonly deps: MenuHandlerDeps) {}

	async buildMenus(tab: Tab): Promise<void> {
		const { browserApi, tcLayer } = this.deps

		await browserApi.menus.removeAll()

		const containers = await browserApi.contextualIdentities.query({})
		const activeCookieStoreId = tab.cookieStoreId

		const permanentContainers: ContextualIdentity[] = []
		const temporaryContainers: ContextualIdentity[] = []

		for (const container of containers) {
			if (container.cookieStoreId === activeCookieStoreId) continue
			const isTemp = await tcLayer.isTempContainer(container.cookieStoreId)
			if (isTemp) {
				temporaryContainers.push(container)
			} else {
				permanentContainers.push(container)
			}
		}

		if (!tcLayer.isPresent()) {
			for (const container of permanentContainers) {
				await this.createContainerItem(MENU_PRIMARY, container, undefined)
			}
			await browserApi.menus.refresh()
			return
		}

		const activeIsTemporary = await tcLayer.isTempContainer(activeCookieStoreId ?? '')

		const primaryContainers = activeIsTemporary ? permanentContainers : temporaryContainers
		const secondaryContainers = activeIsTemporary ? temporaryContainers : permanentContainers
		const primaryTitle = activeIsTemporary ? 'Clone to Permanent Container' : 'Clone to Temporary Container'
		const secondaryTitle = activeIsTemporary ? 'Clone to Temporary Container' : 'Clone to Permanent Container'

		await browserApi.menus.create({ id: MENU_PRIMARY, title: primaryTitle, contexts: ['tab'] })
		for (const container of primaryContainers) {
			await this.createContainerItem(MENU_PRIMARY, container, MENU_PRIMARY)
		}
		await browserApi.menus.create({
			id: `${MENU_PRIMARY}-${NEW_TEMP_CONTAINER_SENTINEL}`,
			parentId: MENU_PRIMARY,
			title: 'New Temporary Container',
			icons: { 16: 'icons/temp-container.svg' },
			contexts: ['tab'],
		})

		await browserApi.menus.create({ id: MENU_SECONDARY, title: secondaryTitle, contexts: ['tab'] })
		for (const container of secondaryContainers) {
			await this.createContainerItem(MENU_SECONDARY, container, MENU_SECONDARY)
		}

		await browserApi.menus.refresh()
	}

	async handleClick(info: MenusOnClickInfo, tab: Tab): Promise<void> {
		const { cloneRuntime } = this.deps

		const menuItemId = String(info.menuItemId)
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

	private async createContainerItem(prefix: string, container: ContextualIdentity, parentId: string | undefined): Promise<void> {
		await this.deps.browserApi.menus.create({
			id: `${prefix}-${container.cookieStoreId}`,
			...(parentId !== undefined ? { parentId } : {}),
			title: container.name,
			icons: { 16: `icons/${container.icon}.svg#${container.color}` },
			contexts: ['tab'],
		})
	}
}
