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

/**
 * Firefox's real cookieStoreId for the default (no-container) cookie jar. Used as an
 * ordinary cookieStoreId value in tabs.create/cookies.getAll/cookies.set, so "No Container"
 * needs no special-casing in cloneRuntime — it's just another clone target.
 */
export const NO_CONTAINER = 'firefox-default'

/** Menu item id prefixes — primary/secondary swap contents based on the active tab's container type. */
export const MENU_PRIMARY = 'get-clone-primary'
export const MENU_SECONDARY = 'get-clone-secondary'

/** Top-level menu item id for "clear domain data for this container". Always present on accessible sites. */
export const MENU_CLEAR = 'get-clone-clear'

/** Menu item id for the informational page opened when a clone/clear action fails (e.g. restricted domain). */
export const MENU_RESTRICTED = 'get-clone-restricted'

/** URL schemes for privileged browser pages where no extension menu should ever appear. */
export const PRIVILEGED_URL_SCHEMES = ['about:', 'moz-extension:', 'chrome:', 'resource:'] as const
