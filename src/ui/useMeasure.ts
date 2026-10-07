import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Measure a container's pixel width so charts can size their viewBox to match.
 *
 * Without this a fixed viewBox scaled down to a phone shrinks the axis text
 * along with everything else — a 10px label becomes 3px. Sizing the viewBox to
 * the real width keeps 1 SVG unit == 1 CSS pixel at every screen size.
 */
export function useMeasure<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width];
}
