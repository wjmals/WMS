
const nextConfig = {
	async rewrites() {
		const rustApiUrl = (process.env.RUST_API_URL || 'http://localhost:8080').replace(/\/$/, '');
		return [
			{
				source: '/api/:path*',
				destination: `${rustApiUrl}/api/:path*`,
			},
		];
	},
};
module.exports = nextConfig;
