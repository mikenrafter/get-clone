/**
 * Gecko extension IDs for both Temporary Containers variants.
 * The original (stoically) is unmaintained but still widely installed.
 * TC+ (GodKratos) is the actively-maintained fork with identical API.
 */
export const TEMP_CONTAINERS_EXTENSION_IDS = [
	'{c607c8df-14a7-4f28-894f-29e8722976af}',  // Temporary Containers (stoically)
	'{1ea2fa75-677e-4702-b06a-50fc7d06fe7e}',  // Temporary Containers Plus (GodKratos)
] as const

/** Sentinel menu-item id suffix for "clone into a brand-new Temporary Container". */
export const NEW_TEMP_CONTAINER_SENTINEL = 'new-temp-container'

/** Menu item id prefixes — primary/secondary swap contents based on the active tab's container type. */
export const MENU_PRIMARY = 'get-clone-primary'
export const MENU_SECONDARY = 'get-clone-secondary'
