import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState } from 'react';

export type Route = '/' | '/login' | '/chat' | '/history';

function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/login' || path === '/chat' || path === '/history' ? path : '/';
}

export function navigate(to: Route, replace = false) {
  if (currentRoute() === to && window.location.pathname === to) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}

export function Link({ to, onClick, ...rest }: { to: Route } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
