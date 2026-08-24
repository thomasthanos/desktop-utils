(function () {
  const TONES = {
    danger: {
      path: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
      icon: 'modal-icon modal-icon-danger',
      button: 'button button-danger'
    },
    warn: {
      path: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
      icon: 'modal-icon modal-icon-warn',
      button: 'button button-primary'
    }
  };

  let dialog = null;
  let active = null;

  function build() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'confirmDialogTitle');
    backdrop.style.display = 'none';

    backdrop.innerHTML = [
      '<div class="modal-card">',
      '  <div class="modal-title-row">',
      '    <span class="modal-icon modal-icon-danger" data-confirm-icon>',
      '      <svg viewBox="0 0 24 24"><path d="" data-confirm-icon-path></path></svg>',
      '    </span>',
      '    <span class="modal-title" id="confirmDialogTitle" data-confirm-title></span>',
      '  </div>',
      '  <p class="modal-copy" data-confirm-copy></p>',
      '  <div class="modal-actions">',
      '    <button type="button" class="button button-secondary" data-confirm-cancel></button>',
      '    <button type="button" class="button button-danger" data-confirm-ok></button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) settle(false);
    });
    backdrop.querySelector('[data-confirm-cancel]').addEventListener('click', () => settle(false));
    backdrop.querySelector('[data-confirm-ok]').addEventListener('click', () => settle(true));

    return backdrop;
  }

  function settle(answer) {
    if (!active) return;

    const { resolve, opener } = active;
    active = null;

    dialog.style.display = 'none';
    if (opener && document.contains(opener)) opener.focus();
    resolve(answer);
  }

  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); settle(false); }
  });

  window.dashboardConfirm = function dashboardConfirm(options) {
    const settings = options || {};

    // Μια ερώτηση τη φορά — η προηγούμενη κλείνει σαν να πατήθηκε Άκυρο.
    if (active) settle(false);
    if (!dialog) dialog = build();

    dialog.querySelector('[data-confirm-title]').textContent = settings.title || 'Είσαι σίγουρος;';
    dialog.querySelector('[data-confirm-copy]').textContent = settings.copy || 'Αυτή η ενέργεια δεν αναιρείται.';
    dialog.querySelector('[data-confirm-cancel]').textContent = settings.cancelLabel || 'Άκυρο';

    const okButton = dialog.querySelector('[data-confirm-ok]');
    okButton.textContent = settings.confirmLabel || 'Συνέχεια';

    const tone = settings.tone === 'warn' ? TONES.warn : TONES.danger;
    dialog.querySelector('[data-confirm-icon]').className = tone.icon;
    dialog.querySelector('[data-confirm-icon-path]').setAttribute('d', tone.path);
    okButton.className = tone.button;

    dialog.style.display = 'flex';

    return new Promise((resolve) => {
      active = { resolve, opener: document.activeElement };
      okButton.focus();
    });
  };
})();
