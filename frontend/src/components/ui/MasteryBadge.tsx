interface Props {
  /** Full Tailwind class string for the pill (colors, padding, rounding, etc.) */
  className: string;
  /** When true, renders a red ! indicator overlapping the top-right border of the pill. */
  isStruggling?: boolean;
  children: React.ReactNode;
}

/**
 * A mastery-level pill badge with an optional red "!" indicator for struggling birds.
 * The indicator overlaps the top-right border of the pill.
 * Wrap in a flex/inline-flex parent — the outer element is `inline-flex relative`.
 */
export function MasteryBadge({ className, isStruggling = false, children }: Props) {
  return (
    <span className="relative inline-flex shrink-0">
      <span className={className}>{children}</span>
      {isStruggling && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[9px] leading-none rounded-full flex items-center justify-center font-bold pointer-events-none select-none">
          !
        </span>
      )}
    </span>
  );
}
