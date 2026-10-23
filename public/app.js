// Progressive enhancement only: every page works without JavaScript.
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

document.querySelectorAll('[data-autosubmit]').forEach((el) => {
  el.addEventListener('change', () => el.form.submit());
});

document.querySelectorAll('tr[data-href]').forEach((row) => {
  row.addEventListener('click', (e) => {
    if (!e.target.closest('a, button, form')) window.location = row.dataset.href;
  });
});

document.querySelectorAll('[data-scroll-active]').forEach((strip) => {
  strip.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
});

const toast = document.querySelector('.toast');
if (toast) {
  setTimeout(() => toast.classList.add('hide'), 4000);
  const url = new URL(window.location);
  if (url.searchParams.has('ok')) {
    url.searchParams.delete('ok');
    history.replaceState(null, '', url);
  }
}
