// Solid, rounded icons with no outlines: the bottom bar and the category pictures.
// Each shape gets a same-color stroke with round joins, which softens every corner.
// "m" is the main shape (drawn in the icon color); "d" is the details, drawn in `detail`
// (usually the background behind the icon, so they read as cut-outs).

const SHAPES = {
  home: { m: ["M3 11.2 12 3.5l9 7.7V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"], d: ["M10 21.5v-5a2 2 0 0 1 4 0v5z"] },
  search: { m: ["M10.5 2.5a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M15.6 17.2l1.6-1.6 4.6 4.6a1.13 1.13 0 0 1-1.6 1.6z"], d: ["M10.5 6a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"] },
  megaphone: { m: ["M2.5 9.8a2 2 0 0 1 2-2h3.2L16.5 3v17.6l-8.8-4.8H4.5a2 2 0 0 1-2-2z", "M7.2 16.2h3.4l1.2 4.8H8.6z", "M19.3 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z"], d: [] },
  people: { m: ["M17 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M15.6 14.3A5.6 5.6 0 0 1 22.3 20.5h-4.6a8 8 0 0 0-2.1-6.2z", "M9 4a3.8 3.8 0 1 0 0 7.6A3.8 3.8 0 0 0 9 4z", "M2 20.5a7 7 0 0 1 14 0z"], d: [] },
  chat: { m: ["M4.5 3.5h15a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4h-.5A2.5 2.5 0 0 1 2 16V6a2.5 2.5 0 0 1 2.5-2.5z"], d: ["M7.5 9.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z", "M12 9.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z", "M16.5 9.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z"] },
  backpack: { m: ["M9.4 4.8a2.6 2.6 0 0 1 5.2 0V6.5h-1.7V4.8a.9.9 0 0 0-1.8 0v1.7H9.4z", "M7.5 6h9A3.5 3.5 0 0 1 20 9.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-10A3.5 3.5 0 0 1 7.5 6z"], d: ["M8 14.2h8v4.3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z", "M10 10.6h4V12h-4z"] },
  laptop: { m: ["M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9h-17V6A1.5 1.5 0 0 1 5 4.5z", "M2 16.5h20a1 1 0 0 1-1 2.5H3a1 1 0 0 1-1-2.5z"], d: ["M6 6.8h12v6.4H6z"] },
  lamp: { m: ["M8 3h8l3.5 7.5h-15z", "M11.2 10.5h1.6v8.5h-1.6z", "M7 19.5h10a1.5 1.5 0 0 1 0 3H7a1.5 1.5 0 0 1 0-3z"], d: [] },
  mug: { m: ["M3 6h12.5v9.5a4.5 4.5 0 0 1-4.5 4.5H7.5A4.5 4.5 0 0 1 3 15.5z", "M19 8.1a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"], d: ["M19 9.9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"] },
  shirt: { m: ["M8.6 2.8 2.6 6l2.2 5 2.2-.9V21h10V10.1l2.2.9 2.2-5-6-3.2a3.4 3.4 0 0 1-6.8 0z"], d: ["M13.6 11.5h2.4v2.4h-2.4z"] },
  shades: { m: ["M1.5 7.4h21v1.8h-21z", "M2.6 8.6h7.8l-.5 5.2a3.2 3.2 0 0 1-3.2 2.9h-.6a3.2 3.2 0 0 1-3.2-2.9z", "M13.6 8.6h7.8l-.3 5.2a3.2 3.2 0 0 1-3.2 2.9h-.6a3.2 3.2 0 0 1-3.2-2.9z"], d: ["M4.6 10.4h2.2v1.2H4.6z", "M15.6 10.4h2.2v1.2h-2.2z"] },
  ticket: { m: ["M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-3a2.5 2.5 0 0 0 0-5z"], d: ["M15 7.5h1.4v2H15z", "M15 11h1.4v2H15z", "M15 14.5h1.4v2H15z"] },
  bulb: { m: ["M12 2a7 7 0 0 0-4.2 12.6V16h8.4v-1.4A7 7 0 0 0 12 2z", "M8.2 16h7.6v3.8a2.2 2.2 0 0 1-2.2 2.2h-3.2a2.2 2.2 0 0 1-2.2-2.2z"], d: ["M6.5 17.6h11v1h-11z", "M10.9 8.2h2.2v5.6h-2.2z"] },
  dumbbell: { m: ["M7 10.9h10v2.2H7z", "M4 7.2h3.4v9.6H4z", "M16.6 7.2H20v9.6h-3.4z", "M1.6 9.4h1.6v5.2H1.6z", "M20.8 9.4h1.6v5.2h-1.6z"], d: [] },
  game: { m: ["M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.6 16H9.4l-2.2 2.2A2.5 2.5 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7z"], d: ["M7.3 9.8h1.4v4H7.3z", "M6 11.1h4v1.4H6z", "M15.8 10.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z", "M17.8 12.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"] },
  lipstick: { m: ["M7.8 13.2h8.4v8.6H7.8z", "M8.8 10.4h6.4v2.8H8.8z", "M9.8 10.4V5.6L14.2 3v7.4z"], d: ["M7.8 15.6h8.4v1.3H7.8z"] },
  box: { m: ["M12 2.3 21 6.8v10.4l-9 4.5-9-4.5V6.8z"], d: ["M12 11.6 4.3 7.7l1.1-.6L12 10.4l6.6-3.3 1.1.6z", "M11.3 11.3h1.4v9.6h-1.4z"] },
} as const;

export type SoftIconName = keyof typeof SHAPES;

export function SoftIcon({ name, size = 24, color = 'currentColor', detail = '#fff' }: {
  name: SoftIconName; size?: number; color?: string; detail?: string;
}) {
  const s = SHAPES[name];
  return (
    <svg width={size} height={size} viewBox="-1.5 -1.5 27 27" aria-hidden="true" style={{ flexShrink: 0 }}>
      {s.m.map((d) => <path key={d} d={d} fill={color} stroke={color} strokeWidth={2.6} strokeLinejoin="round" />)}
      {s.d.map((d) => <path key={d} d={d} fill={detail} stroke={detail} strokeWidth={0.9} strokeLinejoin="round" />)}
    </svg>
  );
}
