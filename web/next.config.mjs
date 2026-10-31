import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every route is static, so the site ships as plain files (Cloudflare Pages serves ./out). */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  devIndicators: false,
  // The design runtime does not use StrictMode; matching it keeps lifecycles identical.
  reactStrictMode: false,
  // compiler/compiler.js lives one level up and is shared with the turtlec CLI.
  turbopack: { root },
  outputFileTracingRoot: root
};

export default nextConfig;
