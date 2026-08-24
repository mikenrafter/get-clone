const params = new URLSearchParams(window.location.search)
const domain = params.get('domain') || 'this site'

for (const el of document.querySelectorAll('#domain')) {
	el.textContent = domain
}

document.getElementById('addons-link').addEventListener('click', (e) => {
	e.preventDefault()
	browser.tabs.create({ url: 'about:addons' })
})
