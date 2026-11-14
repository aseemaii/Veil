import { useEffect } from 'react';

/** Makes every bot avatar on the page look toward the pointer. One listener, one frame per move, no React renders. */
export function useBotGaze(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const update = () => {
      frame = 0;
      for (const bot of document.querySelectorAll<HTMLElement>('.msg-avatar.bot')) {
        const box = bot.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, distance / 260);
        bot.style.setProperty('--look-x', `${((dx / distance) * 1.6 * reach).toFixed(2)}px`);
        bot.style.setProperty('--look-y', `${((dy / distance) * 1.2 * reach).toFixed(2)}px`);
      }
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
