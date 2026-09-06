/**
 * Inline SVG icon set. All icons are 16×16 on a 16-unit viewBox, drawn with
 * `currentColor` strokes so they inherit text colour, and sized via the `size`
 * prop where a row needs something bigger. Decorative by default — any icon
 * that carries meaning on its own gets a `title`.
 */

interface IconProps {
  size?: number;
  className?: string;
  title?: string;
}

function svgProps({ size = 16, className, title }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': title ? undefined : (true as const),
    role: title ? ('img' as const) : undefined,
  };
}

/** Git-style branch: a trunk, a branch point, and a node on each. */
export function IconBranch(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <circle cx="4.5" cy="3.5" r="1.75" />
      <circle cx="4.5" cy="12.5" r="1.75" />
      <circle cx="11.5" cy="7" r="1.75" />
      <path d="M4.5 5.25v5.5" />
      <path d="M9.75 7H8.5a4 4 0 0 0-4 4" />
    </svg>
  );
}

/** Two branches converging — used for the compare & merge action. */
export function IconMerge(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <circle cx="4.5" cy="3.5" r="1.75" />
      <circle cx="4.5" cy="12.5" r="1.75" />
      <circle cx="11.5" cy="8" r="1.75" />
      <path d="M4.5 5.25v5.5" />
      <path d="M9.75 8H8.25a3.75 3.75 0 0 1-3.75-3.75" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M2.5 4.5h11" />
      <path d="M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5" />
      <path d="M4 4.5l.6 8.2a.9.9 0 0 0 .9.8h5a.9.9 0 0 0 .9-.8l.6-8.2" />
      <path d="M6.75 7v4" />
      <path d="M9.25 7v4" />
    </svg>
  );
}

export function IconTable(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5" />
      <path d="M2.25 6.25h11.5" />
      <path d="M6.25 6.25v7" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <ellipse cx="8" cy="3.75" rx="5.25" ry="2" />
      <path d="M2.75 3.75v8.5c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-8.5" />
      <path d="M13.25 8c0 1.1-2.35 2-5.25 2s-5.25-.9-5.25-2" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <circle cx="7.25" cy="7.25" r="4.25" />
      <path d="M10.5 10.5l3 3" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M8 3.25v9.5" />
      <path d="M3.25 8h9.5" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M4 6.25L8 10.25l4-4" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M6.25 3.75L10.25 8l-4 4.25" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

/** `{}` — marks schema content, matching the Schema tab. */
export function IconSchema(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M6.25 2.75c-1.5 0-2 .75-2 2v1.5c0 .9-.6 1.5-1.5 1.75.9.25 1.5.85 1.5 1.75v1.5c0 1.25.5 2 2 2" />
      <path d="M9.75 2.75c1.5 0 2 .75 2 2v1.5c0 .9.6 1.5 1.5 1.75-.9.25-1.5.85-1.5 1.75v1.5c0 1.25-.5 2-2 2" />
    </svg>
  );
}

export function IconIndex(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M2.75 4h10.5" />
      <path d="M2.75 8h7" />
      <path d="M2.75 12h4.5" />
      <circle cx="12" cy="11" r="2.25" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M8 2.25l4.75 1.9v3.6c0 2.7-1.9 4.9-4.75 5.9-2.85-1-4.75-3.2-4.75-5.9v-3.6z" />
      <path d="M6.25 8l1.25 1.25 2.5-2.5" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M3 8h10" />
      <path d="M9.25 4.25L13 8l-3.75 3.75" />
    </svg>
  );
}

export function IconDot({ size = 8, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" className={className} aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

/** App mark: stacked layers cut by a branch line. */
export function IconLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <g stroke="var(--logo-ink, #f7f6f2)" strokeWidth="1.7" strokeLinecap="round" fill="none">
        {/* Trunk drops, then grafts across into the second node. */}
        <path d="M8.5 8.9v3.6a4.5 4.5 0 0 0 4.5 4.5h.6" />
        <circle cx="8.5" cy="7" r="1.9" fill="var(--logo-ink, #f7f6f2)" stroke="none" />
        <circle cx="15.5" cy="17" r="1.9" fill="var(--logo-ink, #f7f6f2)" stroke="none" />
      </g>
    </svg>
  );
}
