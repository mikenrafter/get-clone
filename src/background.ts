import { TcLayerImpl } from './background/tcLayer'
import { CloneRuntimeImpl } from './background/cloneRuntime'
import { ClearRuntimeImpl } from './background/clearRuntime'
import { MenuHandlerImpl } from './background/menuHandler'
import type { BrowserApi } from './models'

const browserApi = (globalThis as unknown as { browser: BrowserApi }).browser

const tcLayer = new TcLayerImpl({ browserApi })
const cloneRuntime = new CloneRuntimeImpl({ browserApi, tcLayer })
const clearRuntime = new ClearRuntimeImpl({ browserApi })
const menuHandler = new MenuHandlerImpl({ browserApi, tcLayer, cloneRuntime, clearRuntime })

async function initialize(): Promise<void> {
	await tcLayer.initialize()

	browserApi.menus.onShown.addListener((info, tab) => {
		if (!info.contexts.includes('tab') || !tab) return
		menuHandler.buildMenus(tab).catch(console.error)
	})

	browserApi.menus.onClicked.addListener((info, tab) => {
		if (!tab) return
		menuHandler.handleClick(info, tab).catch(console.error)
	})
}

initialize().catch(console.error)
