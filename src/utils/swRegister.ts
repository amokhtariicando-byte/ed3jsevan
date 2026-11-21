/**
 * Registers the Eyvan Service Worker after window load so it never competes
 * with initial paint or image decoding.
 */
export function registerServiceWorker(): void {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !import.meta.env.PROD
  ) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch(() => {
        // Non-fatal: app works identically without Service Worker
      });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'EYVAN_MENU_UPDATED') {
        window.dispatchEvent(new CustomEvent('eyvan-menu-updated'));
      }
    });
  });
}
