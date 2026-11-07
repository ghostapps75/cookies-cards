import { useEffect, useState } from 'react';

/**
 * Addresses are kept in the hash - "#/canasta" - so that the static host never
 * sees them and a shared link always lands on the right table.
 */

/** What follows "#/": '' for the home screen, otherwise a game id. */
export const currentRoute = (): string => {
    const hash = window.location.hash;
    return hash.startsWith('#/') ? hash.slice(2).replace(/\/+$/, '') : '';
};

export const navigate = (route: string): void => {
    const target = route ? `#/${route}` : '#/';
    if (window.location.hash === target) return;
    window.location.hash = target;
};

export const useRoute = (): string => {
    const [route, setRoute] = useState(currentRoute);
    useEffect(() => {
        const update = () => setRoute(currentRoute());
        window.addEventListener('hashchange', update);
        return () => window.removeEventListener('hashchange', update);
    }, []);
    return route;
};
