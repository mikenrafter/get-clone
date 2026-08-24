# Clear domain data: mechanism choice

## What happened

While scoping iteration 2 (clear-domain-data), an earlier WebFetch summary of the MDN
`browsingData.RemovalOptions` page claimed `cookieStoreId` was "currently limited to the
`firefox-default` and `firefox-private` values" — i.e. unusable for custom containers.
That claim was fabricated by the summarization step and never appeared in the actual
page content. It drove the decision to drop `browsingData` entirely in favor of a manual
`cookies.getAll`/`cookies.remove` loop plus `tabs.executeScript` injected into throwaway
background tabs for localStorage/sessionStorage/indexedDB clearing. Subagent 1 wrote red
tests (`tests/clearRuntime.test.ts`, plus the `MENU_CLEAR` wiring in
`tests/menuHandler.test.ts`) against that design.

## Correction

Re-fetching primary sources directly:

- MDN `browsingData/RemovalOptions`: *"`cookieStoreId` ... This property only applies to
  cookies, indexedDB, and local storage (localStorage) items. The removal is limited to
  items belonging to a specific cookie store as specified by the ID."* — no
  default/private restriction stated.
- [Bugzilla 1670811](https://bugzilla.mozilla.org/show_bug.cgi?id=1670811), "Extend
  browsingData.remove API to remove a subset of data with cookieStoreId" — comment 1:
  *"In my current implementation I also limited `cookieStoreId` to those used for
  contextualIdentities/containers (no private/default store)."* Comment 6: *"We decided
  to change cookieStoreId to a more usual behavior. It now also supports the values
  `firefox-default` and `firefox-private`."* — i.e. container support came first;
  default/private were added on top, not the other way around.
- Firefox 84 release notes: *"The browsingData.remove() API now supports removing a
  subset of data types by cookieStoreId."*

`browsingData.remove({ cookieStoreId, hostnames }, { cookies, localStorage, indexedDB })`
genuinely works for arbitrary custom containers.

## Decision

Rebuild `clearRuntime.ts` around `browsingData.remove()`:

1. Find and close tabs in the target container matching the domain (+ subdomains) —
   unchanged from the original design.
2. Collect the distinct exact hostnames of the tabs just closed.
3. One call: `browsingData.remove({ cookieStoreId: tab.cookieStoreId, hostnames },
   { cookies: true, localStorage: true, indexedDB: true })`.

No throwaway background tabs, no `tabs.executeScript` injection. Requires adding the
`browsingData` permission to `src/manifest.json`.

The original `cookies.remove`/`tabs.executeScript` design is preserved in git history
(the commit immediately before the one that introduces this doc) in case `browsingData`
turns out to have a real-world gap `web-ext`/manual testing surfaces — e.g. partial
per-container isolation for some data type, or a Firefox version constraint. If that
happens, revert to that commit's `clearRuntime.ts` approach rather than re-deriving it.
