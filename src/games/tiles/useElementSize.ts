import { useEffect, useState } from 'react';

export interface ElementSize {
    width: number;
    height: number;
}

/** The content box of an element, kept up to date. Pass the setter as the element's `ref`. */
export const useElementSize = <T extends HTMLElement>(): [(element: T | null) => void, ElementSize] => {
    const [element, setElement] = useState<T | null>(null);
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

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

    return [setElement, size];
};
