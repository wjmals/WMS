
const nextConfig = {
	async rewrites() {
		const rustApiUrl = process.env.RUST_API_URL?.replace(/\/$/, '');
		if (!rustApiUrl) return [];

		return [
			{
				source: '/api/:path*',
				destination: `${rustApiUrl}/api/:path*`,
			},
		];
	},
};
module.exports = nextConfig;
