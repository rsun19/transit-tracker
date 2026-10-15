/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['@mui/material', '@mui/icons-material'],
  },
  async rewrites() {
    // Only for `next dev` without nginx in front. In production nginx routes
    // /api/v1/* itself, so this rewrite would only see paths nginx didn't match
    // (e.g. /API/V1/..., since Next matches case-insensitively) and forward them
    // to the internal, non-rate-limited nginx:8080 server.
    if (process.env.NODE_ENV === 'production') return [];
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
