let registration;
let refreshRequired = false;
let lessonActive = false;

export function setLessonActive(active) {
  lessonActive = active;
}

export function hasPwaUpdate() {
  return refreshRequired || Boolean(registration?.waiting);
}

export function applyPwaUpdate() {
  if (lessonActive) return;
  if (refreshRequired) window.location.reload();
  else registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export async function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let requestedReload = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || requestedReload) return;
      refreshRequired = true;
      if (lessonActive) {
        window.dispatchEvent(new Event('little-fox-update-ready'));
      } else {
        requestedReload = true;
        window.location.reload();
      }
    });
    registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    });
    const notifyUpdate = () => window.dispatchEvent(new Event('little-fox-update-ready'));
    if (registration.waiting) notifyUpdate();
    const watchWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) notifyUpdate();
      });
    };
    watchWorker(registration.installing);
    registration.addEventListener('updatefound', () => watchWorker(registration.installing));
    const checkForUpdate = () => registration.update().catch(() => {});
    if (!hadController) {
      await navigator.serviceWorker.ready;
      window.dispatchEvent(new Event('little-fox-offline-ready'));
    } else await checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    });
    window.setInterval(checkForUpdate, 30 * 60 * 1000);
  } catch {
    // Online play remains available if installation is blocked.
  }
}
