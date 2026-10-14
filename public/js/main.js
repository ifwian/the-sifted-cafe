// Behaviour for the public landing page: mobile menu, opening hours, photo viewer.

// ---------- Mobile navigation ----------
(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  }

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false); // close the menu after choosing a link
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
})();

// ---------- Footer year ----------
(function () {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();

// ---------- Opening hours (read from server/config.js so there is one source of truth) ----------
(function () {
  const places = document.querySelectorAll('[data-hours-for]');
  if (places.length === 0) return;

  getConfig()
    .then((config) => {
      places.forEach((el) => {
        const branch = config.branches.find((b) => b.id === el.dataset.hoursFor);
        el.textContent = branch
          ? `Open Monday to Sunday, ${formatTime12(branch.open)} to ${formatTime12(branch.close)}`
          : 'Opening hours: please contact the cafe.';
        if (branch) {
          const tag = document.createElement('span');
          tag.className = 'tbc';
          tag.textContent = 'TBC';
          el.append(' ', tag);
        }
      });
    })
    .catch(() => {
      places.forEach((el) => { el.textContent = 'Opening hours: please contact the cafe.'; });
    });
})();

// ---------- Gallery photo viewer ----------
(function () {
  const items = Array.from(document.querySelectorAll('.gallery-item'));
  const dialog = document.getElementById('lightbox');
  if (items.length === 0 || !dialog || typeof dialog.showModal !== 'function') return;

  const image = document.getElementById('lightbox-img');
  const caption = document.getElementById('lightbox-caption');
  let current = 0;

  function show(index) {
    current = (index + items.length) % items.length;
    const thumb = items[current].querySelector('img');
    image.src = items[current].dataset.full;
    image.alt = thumb.alt;
    caption.textContent = thumb.alt;
  }

  items.forEach((button, index) => {
    button.addEventListener('click', () => {
      show(index);
      dialog.showModal(); // the browser traps focus inside and returns it when closed
    });
  });

  document.getElementById('lightbox-prev').addEventListener('click', () => show(current - 1));
  document.getElementById('lightbox-next').addEventListener('click', () => show(current + 1));
  document.getElementById('lightbox-close').addEventListener('click', () => dialog.close());

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close(); // click on the dark backdrop
  });
})();
