const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  sassOptions: {
    includePaths: ['./src/styles'],
  },
  // web/ is deployed as a standalone unit (own vendored @natsatopics/shared
  // tarball + own package-lock.json, see scripts/vendor-shared.sh) even
  // though it lives inside the natsatopics npm-workspaces monorepo. Without
  // this, Next.js's automatic workspace-root inference walks up to the
  // repo's root lockfile, which breaks the `output: standalone` file trace
  // (Firebase App Hosting's Next.js adapter sets `output: standalone`) —
  // the traced server.js then fails at runtime with "Cannot find module
  // 'next'" because the trace was computed relative to the wrong root.
  experimental: {
    outputFileTracingRoot: path.join(__dirname),
  },
};

module.exports = nextConfig;
