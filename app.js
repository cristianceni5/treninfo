const html = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const serverHealth = document.getElementById('server-health');
const serverTest = document.getElementById('server-test');

const storedTheme = localStorage.getItem('theme');
if (storedTheme === 'dark') {
    html.classList.add('dark');
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        html.classList.toggle('dark');
        localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
    });
}

const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

if (serverHealth) {
    serverHealth.href = '/api/health';
}

if (serverTest) {
    const localHref = serverTest.dataset.localHref || 'test-chiamate.html';
    if (isLocalhost) {
        serverTest.href = localHref;
        serverTest.classList.remove('hidden');
        serverTest.removeAttribute('aria-disabled');
    } else {
        serverTest.href = '#';
        serverTest.setAttribute('aria-disabled', 'true');
        serverTest.classList.add('hidden');
    }
}

const dragScrollContainers = document.querySelectorAll('[data-drag-scroll]');
dragScrollContainers.forEach((container) => {
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let pointerId = null;

    container.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) {
            return;
        }

        isDown = true;
        pointerId = event.pointerId;
        startX = event.clientX;
        scrollLeft = container.scrollLeft;
        container.classList.add('is-dragging');
        container.setPointerCapture(pointerId);
        event.preventDefault();
    });

    container.addEventListener('pointermove', (event) => {
        if (!isDown) {
            return;
        }

        const deltaX = event.clientX - startX;
        container.scrollLeft = scrollLeft - deltaX;
    });

    const stopDragging = () => {
        if (!isDown) {
            return;
        }
        isDown = false;
        pointerId = null;
        container.classList.remove('is-dragging');
    };

    container.addEventListener('pointerup', stopDragging);
    container.addEventListener('pointercancel', stopDragging);
    container.addEventListener('pointerleave', stopDragging);
});
