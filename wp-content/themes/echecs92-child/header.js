document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.cm-burger');
    const menu = document.getElementById('cm-mobile-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        if (open) {
            menu.setAttribute('hidden', 'hidden');
        } else {
            menu.removeAttribute('hidden');
        }
    });
});
