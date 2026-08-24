const params = new URLSearchParams(window.location.search)
const domain = params.get('domain') || 'this site'

for (const el of document.querySelectorAll('#domain, #domain-inline')) {
	el.textContent = domain
}

document.getElementById('open-addons').addEventListener('click', () => {
	browser.tabs.create({ url: 'about:addons' })
})
