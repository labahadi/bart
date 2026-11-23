/* eslint-disable @next/next/no-img-element */
// bart mascot components. Images live in /public/mascot. Styles in mascot.css.

type Face =
  | "logo-face"
  | "sniffing"
  | "trade-locked-in"
  | "oops"
  | "new-alert"
  | "thinking"
  | "hot-offer"
  | "time-ticking"
  | "smirk"
  | "trade-accepted";

const faceSrc: Record<Face, string> = {
  "logo-face": "/mascot/logo-face.png",
  sniffing: "/mascot/face-sniffing.png",
  "trade-locked-in": "/mascot/face-trade-locked-in.png",
  oops: "/mascot/face-oops.png",
  "new-alert": "/mascot/face-new-alert.png",
  thinking: "/mascot/face-thinking.png",
  "hot-offer": "/mascot/face-hot-offer.png",
  "time-ticking": "/mascot/face-time-ticking.png",
  smirk: "/mascot/face-smirk.png",
  "trade-accepted": "/mascot/face-trade-accepted.png",
};

/** Logo full body with a wagging tail. Slow by default, fast when excited. */
export function WaggingDog({ height = 340, excited = false }: { height?: number; excited?: boolean }) {
  return (
    <div className={`bart-dog${excited ? " bart-dog--excited" : ""}`} style={{ height }}>
      <img className="bart-dog__tail" src="/mascot/logo-full-body-tail.png" alt="" />
      <img src="/mascot/logo-full-body-body.png" alt="bart dog wagging its tail" />
    </div>
  );
}

/** A single mascot face. `motion` adds the sniff loop, the breathe pulse, or the one-time pop-in. */
export function MascotFace({
  face,
  width = 120,
  motion,
  alt = "",
}: {
  face: Face;
  width?: number;
  motion?: "sniff" | "pop-in" | "breathe";
  alt?: string;
}) {
  const cls =
    motion === "sniff" ? "bart-sniff" : motion === "pop-in" ? "bart-pop-in" : motion === "breathe" ? "bart-breathe" : undefined;
  return <img className={cls} src={faceSrc[face]} alt={alt} style={{ width, height: "auto" }} />;
}

/** Header logo: logo face + "bart" wordmark. */
export function BartLogo({ size = 27, color = "#1B2A8C" }: { size?: number; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3 }}>
      <img src="/mascot/logo-face.png" alt="" style={{ width: size * 1.4, height: "auto" }} />
      <span style={{ fontWeight: 800, fontSize: size, letterSpacing: -size * 0.04, color }}>bart</span>
    </span>
  );
}

/** "Sniffing around..." loading line. */
export function SniffingDots({ label = "Sniffing around" }: { label?: string }) {
  return (
    <span className="bart-dots">
      {label}
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

/** Trade of the Week badge: lime circle + pulsing ring + breathing dog. Place inside the card (position: relative; overflow: hidden). */
export function TradeOfWeekDog() {
  const circle = { position: "absolute" as const, right: -10, top: -28, width: 136, height: 136 };
  return (
    <>
      <span aria-hidden style={{ ...circle, borderRadius: 999, background: "#D9FF3D" }} />
      <span aria-hidden className="bart-ring" style={circle} />
      <img
        className="bart-breathe"
        src="/mascot/face-trade-accepted.png"
        alt="bart dog celebrating"
        style={{ position: "absolute", right: 8, top: 10, width: 100, height: "auto" }}
      />
    </>
  );
}

/** "It's live!" post confirmation: heart-eyes dog with a pink check badge. Pops in once, then the badge bounces in. */
export function PostLiveDog({ background = "#F7F8FF" }: { background?: string }) {
  return (
    <span className="bart-pop-in" style={{ position: "relative", display: "inline-block" }}>
      <img src="/mascot/face-hot-offer.png" alt="bart dog with heart eyes" style={{ width: 166, height: "auto", display: "block" }} />
      <span
        className="bart-badge-in"
        aria-hidden
        style={{
          position: "absolute", right: -6, bottom: 4, width: 52, height: 52, borderRadius: 999,
          background: "#FF2E92", border: `4px solid ${background}`, boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

/** Find: no results. Same blue card as the loading state, sniffing dog, with the two actions inside the card. */
export function NoResultsCard({ onPostWanted, onBrowse }: { onPostWanted?: () => void; onBrowse?: () => void }) {
  const btn = { height: 52, border: 0, borderRadius: 999, fontFamily: "inherit", fontWeight: 800, fontSize: 16 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, background: "#3355FF", color: "#FFFFFF", borderRadius: 24, padding: "10px 16px 6px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MascotFace face="sniffing" width={70} motion="sniff" alt="bart dog sniffing around" />
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <b style={{ fontSize: 17 }}>Couldn&apos;t sniff it out</b>
          <span style={{ fontSize: 13, color: "#E4E9FF" }}>Nothing matches yet.</span>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 6 }}>
        <button type="button" onClick={onPostWanted} style={{ ...btn, background: "#D9FF3D", color: "#111116" }}>Post a Wanted</button>
        <button type="button" onClick={onBrowse} style={{ ...btn, height: 48, fontSize: 15, fontWeight: 700, background: "transparent", color: "#FFFFFF" }}>Browse everything</button>
      </div>
    </div>
  );
}
