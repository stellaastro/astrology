/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * PRODUCTION BUILDS GO IN `.next-prod`, dev stays on the default `.next`.
   *
   * The review server (`npm run dev:review`, :3001) runs out of the same
   * checkout as the live site, so the two must not share a build directory.
   *
   * The first attempt pointed *dev* at a custom dir and left production on
   * `.next`. That leaked: on a next.config.mjs change Next restarts and writes
   * `.next/diagnostics/build-diagnostics.json` to the DEFAULT path regardless
   * of distDir — straight into the directory the live site was serving. It only
   * surfaced because that file happened to be root-owned, so the dev server
   * crashed with EACCES instead of silently writing there.
   *
   * So it is inverted: dev keeps the default path Next insists on using, and
   * production moves somewhere dev never touches. Keying off NODE_ENV rather
   * than an explicit variable means it cannot be forgotten — `next build` and
   * `next start` set it to production themselves, `next dev` to development.
   */
  distDir: process.env.NEXT_DIST_DIR
    || (process.env.NODE_ENV === 'production' ? '.next-prod' : '.next'),
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
