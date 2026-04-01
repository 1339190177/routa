"use client";

import React from "react";
import { Waypoints } from "lucide-react";

interface HarnessMarkProps {
  className?: string;
  title?: string;
}

/**
 * Harness now uses a standard lucide icon so the settings/navigation surface
 * stays aligned with the rest of the icon system.
 */
export function HarnessMark({
  className = "h-5 w-5",
  title = "Harness",
}: HarnessMarkProps) {
  return (
    <Waypoints
      className={className}
      strokeWidth={1.8}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    />
  );
}
