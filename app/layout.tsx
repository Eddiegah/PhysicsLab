import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PhysicsLab — Real-Time GPU Fluid & Cloth Simulation",
  description:
    "GPU-accelerated Navier-Stokes fluid dynamics and mass-spring cloth simulation running in real time in your browser via WebGL2.",
  keywords: [
    "fluid simulation", "Navier-Stokes", "WebGL2", "cloth simulation",
    "Verlet integration", "physics", "GPU", "real-time",
  ],
  openGraph: {
    title: "PhysicsLab",
    description: "Real-time GPU fluid & cloth physics simulation in the browser.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050510",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
