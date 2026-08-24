(function () {
  const SWAP_SELECTOR = 'main.main';
  const LINK_SELECTOR = '.sidebar-item';

  if (!window.history || typeof window.history.pushState !== 'function') return;
  if (!window.DOMParser || !window.fetch) return;

  let inFlight = null;

  function isInternal(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
    if (anchor.origin !== window.location.origin) return false;
    return anchor.pathname !== '/login';
  }

  function markActive(pathname) {
    document.querySelectorAll(LINK_SELECTOR).forEach((item) => {
      if (item.tagName !== 'A') return;

      const active = item.pathname === pathname;
      item.classList.toggle('active', active);

      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  function runPageScripts(doc) {
    document.querySelectorAll('script[data-page-script]').forEach((old) => old.remove());

    doc.querySelectorAll('script[data-page-script]').forEach((incoming) => {
      const fresh = document.createElement('script');
      fresh.setAttribute('data-page-script', '');
      fresh.textContent = incoming.textContent;
      document.body.appendChild(fresh);
    });
  }

  async function swapTo(url, push) {
    const token = {};
    inFlight = token;

    document.body.classList.add('is-navigating');

    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`status ${response.status}`);

      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const incoming = doc.querySelector(SWAP_SELECTOR);
      const current = document.querySelector(SWAP_SELECTOR);
      if (!incoming || !current) throw new Error('no main element');

      if (inFlight !== token) return;

      current.replaceWith(incoming);
      document.title = doc.title || document.title;

      if (doc.body.dataset.page) document.body.dataset.page = doc.body.dataset.page;
      if (doc.body.dataset.guildId) document.body.dataset.guildId = doc.body.dataset.guildId;

      markActive(new URL(url, window.location.origin).pathname);
      runPageScripts(doc);

      if (push) window.history.pushState({ dashboardNav: true }, '', url);

      incoming.scrollTop = 0;
      window.scrollTo(0, 0);
    } catch {
      window.location.href = url;
    } finally {
      if (inFlight === token) inFlight = null;
      document.body.classList.remove('is-navigating');
    }
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest(`a${LINK_SELECTOR}`);
    if (!anchor || !isInternal(anchor)) return;

    const url = anchor.href;
    if (url === window.location.href) { event.preventDefault(); return; }

    event.preventDefault();
    swapTo(url, true);
  });

  window.addEventListener('popstate', () => {
    swapTo(window.location.href, false);
  });
})();
