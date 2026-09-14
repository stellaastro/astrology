/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * The review server (`npm run dev:review`, port 3001) runs out of the SAME
   * checkout as production. Without a separate build directory it would write
   * its dev output straight over the `.next/` that `next start` is serving, and
   * the live site would break the moment a file changed.
   *
   * NEXT_DIST_DIR is set only by stella-dev.service. Everything else — local
   * development, CI, the production build — keeps `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default nextConfig;
