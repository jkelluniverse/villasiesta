/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Photos are pre-sized local JPGs served statically; skip the optimizer to keep
  // the Railway image pipeline dependency-free.
  images: { unoptimized: true },
};
export default nextConfig;
