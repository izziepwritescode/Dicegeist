// page transition: every route fades + rises in on navigation
// Usage Syntax: picked up automatically by Next.js; re-mounts on each route change (unlike layout)

"use client";

import { motion } from "motion/react"; //animated div

// wraps the current page in an enter animation
//params: children (React.ReactNode) - current page
//output: JSX.Element
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} //same curve as --ease in globals.css
    >
      {children}
    </motion.div>
  );
}
