/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["whatsapp-web.js", "puppeteer", "puppeteer-core", "ffmpeg-static"],
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok.io",
    "*.ngrok.app",
  ],
};

export default nextConfig;
