(function () {
  // Το μενού μένει absolute μέσα στο .perm-drop — το main έχει transform, οπότε
  // ένα fixed μενού θα κρεμόταν από εκείνο και όχι από το viewport. Ό,τι το
  // έκοβε ήταν το overflow:hidden του πίνακα, που έφυγε από το CSS.
  const MARGIN = 12;

  let open = null;

  function menuOf(drop) {
    return drop.querySelector('.perm-drop-menu');
  }

  // Το όριο δεν είναι το παράθυρο αλλά η περιοχή που κυλάει (το <main>): εκεί
  // κόβεται στην πράξη το μενού.
  function viewportOf(element) {
    let el = element.parentElement;

    while (el && el !== document.body) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }
      el = el.parentElement;
    }
    return { top: 0, bottom: window.innerHeight };
  }

  // Αν δεν χωράει από κάτω αλλά χωράει καλύτερα από πάνω, ανοίγει προς τα πάνω.
  function place(drop) {
    const menu = menuOf(drop);
    const trigger = drop.querySelector('.perm-drop-trigger');
    if (!menu || !trigger) return;

    drop.classList.remove('opens-up');

    const anchor = trigger.getBoundingClientRect();
    const bounds = viewportOf(drop);
    const height = menu.getBoundingClientRect().height;

    const below = bounds.bottom - anchor.bottom - MARGIN;
    const above = anchor.top - bounds.top - MARGIN;

    if (height > below && above > below) drop.classList.add('opens-up');
  }

  function close(drop) {
    const menu = menuOf(drop);
    drop.classList.remove('is-open', 'opens-up');
    if (menu) menu.hidden = true;

    const trigger = drop.querySelector('.perm-drop-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');

    if (open === drop) open = null;
  }

  function closeAll(except) {
    document.querySelectorAll('.perm-drop.is-open').forEach((drop) => {
      if (drop !== except) close(drop);
    });
    if (!except) open = null;
  }

  function show(drop) {
    closeAll(drop);

    const menu = menuOf(drop);
    if (!menu) return;

    drop.classList.add('is-open');
    menu.hidden = false;

    const trigger = drop.querySelector('.perm-drop-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');

    open = drop;
    place(drop);
  }

  function toggle(drop) {
    if (drop.classList.contains('is-open')) { close(drop); return false; }
    show(drop);
    return true;
  }

  // Ένα κλικ έξω κλείνει μόνο το ανοιχτό μενού. Όταν το έκανε κάθε σελίδα
  // μόνη της, ο handler της μιας ενότητας έκλεινε και τα dropdown της άλλης.
  document.addEventListener('click', (event) => {
    if (open && !event.target.closest('.perm-drop')) closeAll(null);
  });

  // Το μενού κυλάει μαζί με τη γραμμή του, αλλά μετά από αλλαγή μεγέθους η
  // επιλογή πάνω/κάτω μπορεί να μην ισχύει πια.
  window.addEventListener('resize', () => { if (open) place(open); });

  window.dashboardDropdown = { show, close, closeAll, toggle, place };
})();
