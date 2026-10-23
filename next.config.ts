import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "youtube-dl-exec",
    "ffmpeg-static",
    "ffprobe-static",
    "archiver",
    "youtubei.js",
    "bgutils-js",
    "jsdom",
  ],
  poweredByHeader: false,
};

export default nextConfig;
