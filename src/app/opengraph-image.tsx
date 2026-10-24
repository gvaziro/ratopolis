import { ImageResponse } from "next/og";
import { BRASS, MARK_URI, SOOT, WHEEL_URI } from "./brand";

/** The link preview (SH-6): a giant train wheel, a tiny rat with a sack, the title and the two-scale tagline. */
export const alt = "Ratropolis Underground — Крысиный мегаполис";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `radial-gradient(ellipse at 70% 20%, #3b3022, ${SOOT} 70%)`,
          color: "#eadcc0",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WHEEL_URI} width={760} height={760} alt="" style={{ position: "absolute", left: -260, top: -40, opacity: 0.9 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, height: 10, background: "#8a8a94", display: "flex" }} />
        <div style={{ position: "absolute", right: 70, bottom: 66, display: "flex", alignItems: "flex-end" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_URI} width={110} height={110} alt="" />
          <div style={{ width: 44, height: 40, marginLeft: -16, marginBottom: 6, borderRadius: 14, background: "#8a6438", border: "3px solid #3a2a1a", display: "flex" }} />
        </div>
        <div style={{ position: "absolute", left: 470, top: 90, right: 60, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 700, color: BRASS, lineHeight: 1.05 }}>Ratropolis Underground</div>
          <div style={{ fontSize: 46, marginTop: 8, color: "#e8c983" }}>Крысиный мегаполис</div>
          <div style={{ fontSize: 30, marginTop: 36, fontStyle: "italic", color: "#eadcc0" }}>Для людей это один вторник. Для крыс — целая история</div>
        </div>
      </div>
    ),
    size,
  );
}
