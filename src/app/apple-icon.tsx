import { ImageResponse } from "next/og";
import { MARK_URI, SOOT } from "./brand";

/** Home-screen icon (SH-6): the Rat King mark on a rounded soot square. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: SOOT, borderRadius: 36 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_URI} width={150} height={150} alt="" />
      </div>
    ),
    size,
  );
}
