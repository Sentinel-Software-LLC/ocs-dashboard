/** @type {import('next').NextConfig} */
const nextConfig = {
  // A4: Bundle hash for integrity
  generateBuildId: async () => {
    const { execSync } = await import('child_process');
    try {
      return execSync('git rev-parse HEAD').toString().trim().slice(0, 12);
    } catch {
      return `build-${Date.now()}`;
    }
  },
  // A4: CSP and security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' http://localhost:* http://192.168.69.*:* ws: wss:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
