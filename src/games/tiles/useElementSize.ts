import { useCallback, useEffect, useState } from 'react';

export interface ElementSize {
    width: number;
    height: number;
}

const contentBox = (element: HTMLElement): ElementSize => {
    const style = getComputedStyle(element);
    return {
        width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
};

/**
 * The content box of an element, kept up to date. Pass the setter as the
 * element's `ref`. It measures as soon as the element exists, before the first
 * paint, so a table opens already sized instead of sliding into place.
 */
export const useElementSize = <T extends HTMLElement>(): [(element: T | null) => void, ElementSize] => {
    const [element, setElement] = useState<T | null>(null);
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

    const ref = useCallback((next: T | null) => {
        setElement(next);
        if (next) setSize(contentBox(next));
    }, []);

    useEffect(() => {
        if (!element) return;
        const observer = new ResizeObserver(entries => {
            const box = entries[0].contentRect;
            setSize(previous =>
                previous.width === box.width && previous.height === box.height
                    ? previous
                    : { width: box.width, height: box.height },
            );
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return [ref, size];
};
