/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Telegram webhook and admin API run on the Node.js runtime.
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "xlsx"],
  },
};

export default nextConfig;
