import { ReactNode } from "react";

interface ConditionCheckerProps {
  condition: boolean;
  children: ReactNode;
}

/**
 * A component that conditionally renders its children based on a condition value
 * @param condition - Boolean value determining whether to render the children
 * @param children - React nodes to render when condition is true
 */
export default function ConditionChecker({
  condition,
  children,
}: ConditionCheckerProps) {
  if (condition) return children;
  return null;
}
