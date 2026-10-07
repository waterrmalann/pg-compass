import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Width of the strip edge zones that scroll the strip while dragging. */
const EDGE_SCROLL_ZONE_PX = 40;
const EDGE_SCROLL_MAX_SPEED_PX = 14;
/** docs/DESIGN.md §7 default motion. */
const SLIDE_TRANSITION = "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)";

interface TabSlot {
  left: number;
  width: number;
}

interface ActiveDrag {
  /** Every tab element in strip order, and where each sat at drag start. */
  tabElements: HTMLElement[];
  slots: TabSlot[];
  draggedSlot: TabSlot;
  fromIndex: number;
  targetIndex: number;
  /** How far a neighbour slides to make room: the dragged width plus the gap. */
  slideDistance: number;
  minOffset: number;
  maxOffset: number;
  startScrollLeft: number;
  /** Current horizontal offset of the dragged tab from its original slot. */
  offset: number;
  reducedMotion: boolean;
}

/**
 * Browser-style tab reordering for the workspace tab strip.
 *
 * Moving a pressed tab past a small threshold lifts it: it follows the
 * pointer along the strip while its neighbours slide aside to show where it
 * will land. Dropping commits the new order through `onMoveTab` and lets the
 * tab settle into its slot. Escape cancels. The strip scrolls when the
 * pointer nears either edge.
 *
 * Positions are written straight to the DOM during the drag, so React only
 * renders twice per drag: once when the tab is activated, once on drop.
 * The strip must be the tabs' offset parent (`position: relative`), and each
 * tab must carry `data-tab-id`.
 */
export function useTabReorder({
  tabIds,
  onDragStart,
  onMoveTab,
}: Readonly<{
  tabIds: string[];
  onDragStart: (tabId: string) => void;
  onMoveTab: (tabId: string, toIndex: number) => void;
}>) {
  const stripRef = useRef<HTMLDivElement>(null);
  const cancelDragRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onDragStart, onMoveTab });
  callbacksRef.current = { onDragStart, onMoveTab };

  // Tabs opened or closed mid-drag (Ctrl+W, a connection closing) invalidate
  // the measured positions, so the drag is dropped where it started. The
  // cleanup also runs on unmount.
  const tabIdsKey = tabIds.join("\n");
  useEffect(
    function cancelDragWhenTabsChange() {
      return () => cancelDragRef.current?.();
    },
    [tabIdsKey],
  );

  const handleTabPointerDown = useCallback(
    (tabId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-tab-close]")) {
        return;
      }
      const stripElement = stripRef.current;
      if (!stripElement) return;
      const strip: HTMLDivElement = stripElement;

      cancelDragRef.current?.();

      const element = event.currentTarget;
      const pointerId = event.pointerId;
      const startClientX = event.clientX;
      let clientX = startClientX;
      let drag: ActiveDrag | null = null;
      let scrollFrame = 0;

      function layout(activeDrag: ActiveDrag) {
        const scrollDelta = strip.scrollLeft - activeDrag.startScrollLeft;
        const pointerOffset = clientX - startClientX + scrollDelta;
        const offset = clamp(
          pointerOffset,
          activeDrag.minOffset,
          activeDrag.maxOffset,
        );
        activeDrag.offset = offset;
        element.style.transform = `translateX(${offset}px)`;

        const targetIndex = findTargetIndex(activeDrag);
        if (targetIndex === activeDrag.targetIndex) return;
        activeDrag.targetIndex = targetIndex;

        activeDrag.tabElements.forEach((tabElement, index) => {
          if (index === activeDrag.fromIndex) return;
          const shift = neighbourShift(index, activeDrag);
          tabElement.style.transform =
            shift === 0 ? "" : `translateX(${shift}px)`;
        });
      }

      function scrollAtEdges() {
        if (!drag) return;
        const bounds = strip.getBoundingClientRect();
        const speed = edgeScrollSpeed(clientX, bounds.left, bounds.right);
        if (speed !== 0) {
          const scrollBefore = strip.scrollLeft;
          strip.scrollLeft = scrollBefore + speed;
          if (strip.scrollLeft !== scrollBefore) layout(drag);
        }
        scrollFrame = requestAnimationFrame(scrollAtEdges);
      }

      function handlePointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        clientX = moveEvent.clientX;

        if (!drag) {
          const distance = Math.abs(clientX - startClientX);
          if (distance < DRAG_THRESHOLD_PX) return;
          drag = beginDrag(strip, element);
          if (!drag) {
            stopListening();
            return;
          }
          capturePointer(element, pointerId);
          callbacksRef.current.onDragStart(tabId);
          scrollFrame = requestAnimationFrame(scrollAtEdges);
        }

        layout(drag);
      }

      function handlePointerUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        finish(true);
      }

      function handlePointerCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(false);
      }

      function handleKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key !== "Escape" || !drag) return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false);
      }

      function stopListening() {
        globalThis.removeEventListener("pointermove", handlePointerMove);
        globalThis.removeEventListener("pointerup", handlePointerUp);
        globalThis.removeEventListener("pointercancel", handlePointerCancel);
        globalThis.removeEventListener("keydown", handleKeyDown, true);
        cancelAnimationFrame(scrollFrame);
        cancelDragRef.current = null;
      }

      function finish(commit: boolean) {
        stopListening();
        releasePointer(element, pointerId);
        if (!drag) return;

        const hasMoved = drag.targetIndex !== drag.fromIndex;
        if (commit && hasMoved && element.isConnected) {
          settleIntoNewSlot(drag);
        } else {
          settleBack(drag);
        }
        drag = null;
      }

      function settleIntoNewSlot(activeDrag: ActiveDrag) {
        const draggedLeft = activeDrag.draggedSlot.left + activeDrag.offset;

        // Reorder the DOM synchronously so the neighbours' new layout slots
        // match where they already slid to, then clear their transforms
        // without a transition: nothing visibly moves.
        flushSync(() => {
          callbacksRef.current.onMoveTab(tabId, activeDrag.targetIndex);
        });
        for (const tabElement of activeDrag.tabElements) {
          if (tabElement !== element) resetTransform(tabElement);
        }

        // The dragged tab glides from where it was dropped into its slot.
        const settleFrom = draggedLeft - element.offsetLeft;
        element.style.transition = "none";
        element.style.transform = `translateX(${settleFrom}px)`;
        animateToRest(element, activeDrag.reducedMotion);
      }

      function settleBack(activeDrag: ActiveDrag) {
        for (const tabElement of activeDrag.tabElements) {
          animateToRest(tabElement, activeDrag.reducedMotion);
        }
      }

      globalThis.addEventListener("pointermove", handlePointerMove);
      globalThis.addEventListener("pointerup", handlePointerUp);
      globalThis.addEventListener("pointercancel", handlePointerCancel);
      globalThis.addEventListener("keydown", handleKeyDown, true);
      cancelDragRef.current = () => finish(false);
    },
    [],
  );

  return { stripRef, handleTabPointerDown };
}

function beginDrag(
  strip: HTMLElement,
  element: HTMLElement,
): ActiveDrag | null {
  const tabElements = Array.from(
    strip.querySelectorAll<HTMLElement>(":scope > [data-tab-id]"),
  );
  const slots = tabElements.map((tabElement) => ({
    left: tabElement.offsetLeft,
    width: tabElement.offsetWidth,
  }));
  const fromIndex = tabElements.indexOf(element);
  const draggedSlot = slots[fromIndex];
  const firstSlot = slots[0];
  const lastSlot = slots.at(-1);
  if (!draggedSlot || !firstSlot || !lastSlot) return null;

  const draggedRight = draggedSlot.left + draggedSlot.width;
  const stripRight = lastSlot.left + lastSlot.width;
  const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
  const reducedMotion = prefersReducedMotion();

  for (const tabElement of tabElements) {
    stopSettling(tabElement);
    const isDragged = tabElement === element;
    tabElement.style.transition =
      isDragged || reducedMotion ? "none" : SLIDE_TRANSITION;
  }
  element.dataset.dragging = "true";

  return {
    tabElements,
    slots,
    draggedSlot,
    fromIndex,
    targetIndex: fromIndex,
    slideDistance: draggedSlot.width + gap,
    minOffset: firstSlot.left - draggedSlot.left,
    maxOffset: stripRight - draggedRight,
    startScrollLeft: strip.scrollLeft,
    offset: 0,
    reducedMotion,
  };
}

/**
 * The slot the dragged tab would drop into. Like a browser, a neighbour
 * swaps once the dragged tab covers half of it: its leading edge has passed
 * the neighbour's centre. Centres are the original ones, so moving back and
 * forth over a boundary doesn't flicker, and the clamped ends always reach
 * the first and last slots.
 */
function findTargetIndex(drag: ActiveDrag): number {
  const draggedLeft = drag.draggedSlot.left + drag.offset;
  const draggedRight = draggedLeft + drag.draggedSlot.width;

  let targetIndex = 0;
  drag.slots.forEach((slot, index) => {
    if (index === drag.fromIndex) return;
    const centre = slot.left + slot.width / 2;
    const isBeforeDragged =
      index < drag.fromIndex ? centre < draggedLeft : centre < draggedRight;
    if (isBeforeDragged) targetIndex += 1;
  });
  return targetIndex;
}

/** Tabs between the original and target slot slide over by one slot. */
function neighbourShift(index: number, drag: ActiveDrag): number {
  const { fromIndex, targetIndex, slideDistance } = drag;
  const isBetweenMovingRight = index > fromIndex && index <= targetIndex;
  if (isBetweenMovingRight) return -slideDistance;
  const isBetweenMovingLeft = index < fromIndex && index >= targetIndex;
  if (isBetweenMovingLeft) return slideDistance;
  return 0;
}

function edgeScrollSpeed(clientX: number, left: number, right: number) {
  const depthIntoLeftZone = left + EDGE_SCROLL_ZONE_PX - clientX;
  if (depthIntoLeftZone > 0) {
    const ratio = Math.min(depthIntoLeftZone / EDGE_SCROLL_ZONE_PX, 1);
    return -Math.ceil(ratio * EDGE_SCROLL_MAX_SPEED_PX);
  }
  const depthIntoRightZone = clientX - (right - EDGE_SCROLL_ZONE_PX);
  if (depthIntoRightZone > 0) {
    const ratio = Math.min(depthIntoRightZone / EDGE_SCROLL_ZONE_PX, 1);
    return Math.ceil(ratio * EDGE_SCROLL_MAX_SPEED_PX);
  }
  return 0;
}

/** Remove a transform instantly, then hand transitions back to the classes. */
function resetTransform(element: HTMLElement) {
  element.style.transition = "none";
  element.style.transform = "";
  void element.offsetWidth; // Commit the jump before transitions return.
  element.style.transition = "";
}

/** Finishers for tabs still gliding back after a drop, keyed by tab. */
const settlingTabs = new WeakMap<HTMLElement, () => void>();

/** Jump a still-gliding tab to rest so a new drag starts from clean styles. */
function stopSettling(element: HTMLElement) {
  settlingTabs.get(element)?.();
}

/** Slide an element back to its layout slot, then clear the drag styling. */
function animateToRest(element: HTMLElement, reducedMotion: boolean) {
  stopSettling(element);

  function handleTransitionEnd(event: TransitionEvent) {
    // Transitions on children (the close button fading) bubble up here.
    if (event.target !== element) return;
    finishSettling();
  }

  function finishSettling() {
    element.removeEventListener("transitionend", handleTransitionEnd);
    element.removeEventListener("transitioncancel", handleTransitionEnd);
    settlingTabs.delete(element);
    element.style.transition = "";
    delete element.dataset.dragging;
  }

  const isOffset = element.style.transform !== "";
  if (reducedMotion || !isOffset) {
    resetTransform(element);
    finishSettling();
    return;
  }

  void element.offsetWidth; // Start from the current transform.
  element.style.transition = SLIDE_TRANSITION;
  element.style.transform = "";
  element.addEventListener("transitionend", handleTransitionEnd);
  element.addEventListener("transitioncancel", handleTransitionEnd);
  settlingTabs.set(element, finishSettling);
}

function capturePointer(element: HTMLElement, pointerId: number) {
  // Keeps hover styles off the other tabs and routes the trailing click to
  // the tab itself rather than its select button.
  if (typeof element.setPointerCapture !== "function") return;
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone; the pointerup/cancel handlers still run.
  }
}

function releasePointer(element: HTMLElement, pointerId: number) {
  if (typeof element.hasPointerCapture !== "function") return;
  if (element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
}

function prefersReducedMotion(): boolean {
  const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  return query?.matches ?? false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
