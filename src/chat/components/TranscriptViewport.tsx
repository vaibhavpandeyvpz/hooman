import React, { useCallback, useEffect, useRef } from "react";
import { Box, useInput, useStdin, useStdout } from "ink";
import type { ChatLine } from "../types.js";
import {
  MOUSE_REPORTING_DISABLE,
  MOUSE_REPORTING_ENABLE,
  parseMouseEvents,
} from "../mouse.js";
import { ScrollView, type ScrollViewRef } from "./ScrollView.js";
import { Transcript } from "./Transcript.js";

type TranscriptViewportProps = {
  lines: ChatLine[];
  liveReasoning: string;
  followRequest: number;
};

const WHEEL_LINES = 3;

function isAtBottom(scroll: ScrollViewRef): boolean {
  return scroll.getScrollOffset() >= scroll.getBottomOffset() - 1;
}

function clampScrollOffset(scroll: ScrollViewRef, offset: number): number {
  return Math.max(0, Math.min(offset, scroll.getBottomOffset()));
}

export function TranscriptViewport({
  lines,
  liveReasoning,
  followRequest,
}: TranscriptViewportProps): React.JSX.Element {
  const scrollRef = useRef<ScrollViewRef>(null);
  const stickyRef = useRef(true);
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();

  const remeasure = useCallback(() => {
    scrollRef.current?.remeasure();
  }, []);

  const followIfSticky = useCallback(() => {
    if (!stickyRef.current) {
      return;
    }
    scrollRef.current?.scrollToBottom();
  }, []);

  const scrollBy = useCallback((delta: number) => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    if (delta < 0) {
      stickyRef.current = false;
    }
    scroll.scrollTo(
      clampScrollOffset(scroll, scroll.getScrollOffset() + delta),
    );
    stickyRef.current = isAtBottom(scroll);
  }, []);

  const scrollToTop = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    stickyRef.current = false;
    scroll.scrollToTop();
  }, []);

  const scrollToBottom = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    stickyRef.current = true;
    scroll.scrollToBottom();
  }, []);

  useEffect(() => {
    stdout?.on("resize", remeasure);
    return () => {
      stdout?.off("resize", remeasure);
    };
  }, [remeasure, stdout]);

  useEffect(() => {
    const timer = setTimeout(() => {
      remeasure();
      followIfSticky();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [followIfSticky, lines, liveReasoning, remeasure]);

  useEffect(() => {
    scrollToBottom();
  }, [followRequest, scrollToBottom]);

  useInput((_, key) => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    const page = Math.max(1, scroll.getViewportHeight() - 1);
    if (key.pageUp) {
      scrollBy(-page);
      return;
    }
    if (key.pageDown) {
      scrollBy(page);
      return;
    }
    if ((key.ctrl || key.meta || key.super) && key.home) {
      scrollToTop();
      return;
    }
    if ((key.ctrl || key.meta || key.super) && key.end) {
      scrollToBottom();
    }
  });

  useEffect(() => {
    if (!stdin) {
      return;
    }

    const onData = (data: Buffer | string) => {
      for (const event of parseMouseEvents(data.toString())) {
        if (event.type === "scroll-up") {
          scrollBy(-WHEEL_LINES);
        } else if (event.type === "scroll-down") {
          scrollBy(WHEEL_LINES);
        }
      }
    };

    setRawMode(true);
    process.stdout.write(MOUSE_REPORTING_ENABLE);
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      process.stdout.write(MOUSE_REPORTING_DISABLE);
    };
  }, [scrollBy, setRawMode, stdin]);

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={1}>
      <ScrollView
        ref={scrollRef}
        flexGrow={1}
        width="100%"
        onScroll={(offset) => {
          const scroll = scrollRef.current;
          if (scroll) {
            stickyRef.current = offset >= scroll.getBottomOffset() - 1;
          }
        }}
        onContentHeightChange={followIfSticky}
        onViewportSizeChange={followIfSticky}
      >
        <Box key="transcript" flexDirection="column" width="100%">
          <Transcript lines={lines} liveReasoning={liveReasoning} />
        </Box>
      </ScrollView>
    </Box>
  );
}
