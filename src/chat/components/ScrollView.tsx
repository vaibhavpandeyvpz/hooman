import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box, measureElement, type BoxProps, type DOMElement } from "ink";

export type ScrollViewRef = {
  scrollTo: (offset: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getScrollOffset: () => number;
  getViewportHeight: () => number;
  getBottomOffset: () => number;
  remeasure: () => void;
};

type ScrollViewProps = BoxProps & {
  onScroll?: (offset: number) => void;
  onViewportSizeChange?: (
    size: { width: number; height: number },
    previousSize: { width: number; height: number },
  ) => void;
  onContentHeightChange?: (height: number, previousHeight: number) => void;
  children?: React.ReactNode;
};

function clamp(offset: number, bottomOffset: number): number {
  return Math.max(0, Math.min(offset, bottomOffset));
}

export const ScrollView = forwardRef<ScrollViewRef, ScrollViewProps>(
  (
    {
      children,
      onScroll,
      onViewportSizeChange,
      onContentHeightChange,
      ...boxProps
    },
    ref,
  ) => {
    const viewportRef = useRef<DOMElement>(null);
    const contentRef = useRef<DOMElement>(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [contentHeight, setContentHeight] = useState(0);
    const stateRef = useRef({ scrollOffset, viewportSize, contentHeight });

    stateRef.current = { scrollOffset, viewportSize, contentHeight };

    const bottomOffset = useCallback(() => {
      const { viewportSize, contentHeight } = stateRef.current;
      return Math.max(0, contentHeight - viewportSize.height);
    }, []);

    const scrollTo = useCallback(
      (offset: number) => {
        setScrollOffset((current) => {
          const next = clamp(offset, bottomOffset());
          if (next !== current) {
            onScroll?.(next);
          }
          return next;
        });
      },
      [bottomOffset, onScroll],
    );

    const remeasure = useCallback(() => {
      if (viewportRef.current) {
        const size = measureElement(viewportRef.current);
        const previousSize = stateRef.current.viewportSize;
        if (
          size.width !== previousSize.width ||
          size.height !== previousSize.height
        ) {
          const nextSize = { width: size.width, height: size.height };
          stateRef.current = {
            ...stateRef.current,
            viewportSize: nextSize,
          };
          setViewportSize(nextSize);
          onViewportSizeChange?.(nextSize, previousSize);
        }
      }

      if (contentRef.current) {
        const { height } = measureElement(contentRef.current);
        const previousHeight = stateRef.current.contentHeight;
        if (height !== previousHeight) {
          stateRef.current = {
            ...stateRef.current,
            contentHeight: height,
          };
          setContentHeight(height);
          onContentHeightChange?.(height, previousHeight);
        }
      }
    }, [onContentHeightChange, onViewportSizeChange]);

    useLayoutEffect(() => {
      remeasure();
    });

    useLayoutEffect(() => {
      setScrollOffset((current) => clamp(current, bottomOffset()));
    }, [bottomOffset, contentHeight, viewportSize.height]);

    useImperativeHandle(
      ref,
      () => ({
        scrollTo,
        scrollToTop: () => scrollTo(0),
        scrollToBottom: () => scrollTo(bottomOffset()),
        getScrollOffset: () => stateRef.current.scrollOffset,
        getViewportHeight: () => stateRef.current.viewportSize.height,
        getBottomOffset: bottomOffset,
        remeasure,
      }),
      [bottomOffset, remeasure, scrollTo],
    );

    return (
      <Box
        flexDirection="column"
        flexShrink={1}
        overflow="hidden"
        {...boxProps}
      >
        <Box
          ref={viewportRef}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={1}
          overflow="hidden"
          width="100%"
        >
          <Box
            ref={contentRef}
            flexDirection="column"
            marginTop={-scrollOffset}
            flexShrink={0}
            width="100%"
          >
            {children}
          </Box>
        </Box>
      </Box>
    );
  },
);

ScrollView.displayName = "ScrollView";
