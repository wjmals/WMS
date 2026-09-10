/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // sqlite3는 서버 사이드(Node.js)에서만 동작하므로 외부 패키지로 지정
    serverComponentsExternalPackages: ['sqlite3', 'sqlite'],
  },
};

module.exports = nextConfig;
