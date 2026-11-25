import type { Metadata } from "next";
import "./globals.css";
import { SettingsProvider } from "@/components/settings-provider";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "CareerAI — Resume Optimizer",
  description:
    "Upload your resume and get AI feedback: issues, what to add, and ATS score.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
