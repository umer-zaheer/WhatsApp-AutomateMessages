"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useMotionValue, useSpring } from "framer-motion";

const RING_SIZE = 48;
const CARD_RING_SIZE = 30;

export default function CursorFollower() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [onCard, setOnCard] = useState(false);

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const scale = useSpring(1, { stiffness: 280, damping: 22 });

  const springX = useSpring(x, { stiffness: 220, damping: 26, mass: 0.35 });
  const springY = useSpring(y, { stiffness: 220, damping: 26, mass: 0.35 });

  useEffect(() => {
    setMounted(true);
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    setEnabled(canHover);
    if (!canHover) return;

    function onMove(e) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const overCard = Boolean(hit?.closest(".card"));
      setOnCard(overCard);
      scale.set(1);

      const size = overCard ? CARD_RING_SIZE : RING_SIZE;
      x.set(e.clientX - size / 2);
      y.set(e.clientY - size / 2);

      setVisible(true);
    }

    function onLeave() {
      setVisible(false);
    }

    function onEnter() {
      setVisible(true);
    }

    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, [scale, x, y]);

  if (!mounted || !enabled) return null;

  return createPortal(
    <motion.div
      className={`cursor-aim pointer-events-none fixed left-0 top-0 ${onCard ? "cursor-aim--card" : ""}`}
      style={{
        x: springX,
        y: springY,
        scale,
        opacity: visible ? 1 : 0,
        zIndex: 99999,
      }}
      aria-hidden
    >
      <div className="cursor-aim-ring" />
      <div className="cursor-aim-dot" />
    </motion.div>,
    document.body
  );
}
