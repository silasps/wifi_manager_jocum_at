const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  async redirects() {
    return [
      {
        // UDM injeta ?id=MAC quando vem do captive portal
        source: "/",
        has: [{ type: "query", key: "id" }],
        destination: "/hotspot",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
