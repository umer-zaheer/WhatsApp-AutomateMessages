import Script from "next/script";
import { Bricolage_Grotesque, DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import CursorFollower from "@/components/CursorFollower";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const themeInitScript = `
(function () {
  var s = localStorage.getItem("theme");
  var t = s === "light" || s === "dark" ? s : "dark";
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
})();
`;

export const metadata = {
  title: "WhatsApp Sender",
  description: "Send WhatsApp messages via whatsapp-web.js",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${dmSans.variable} ${bricolage.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="app-bg min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider>
          <CursorFollower />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
