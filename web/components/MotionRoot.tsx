// client wrapper: global animation settings for the motion library
// Usage Syntax: <MotionRoot>{children}</MotionRoot> in app/layout.tsx

"use client";

import { MotionConfig } from "motion/react"; //animation library config provider

// reducedMotion "user" -> transforms skipped when the OS asks for less motion
//params: children (React.ReactNode) - page content
//output: JSX.Element
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
