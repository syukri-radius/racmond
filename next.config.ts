import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The console is proxied by the preview host when it runs in a sandbox and by
   * localhost when it runs on an operator laptop. Dev-mode asset requests from
   * those origins must be allowed, otherwise the client bundle is rejected.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1", "0.0.0.0", "*.e2b.app", "*.arena.ai"],
  /** dockerode is a CommonJS native-ish package: keep it out of the bundler. */
  serverExternalPackages: ["dockerode"],
};

export default nextConfig;
