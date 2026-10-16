import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // Warning: Allows production builds to complete even if ESLint errors exist
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
