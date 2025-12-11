/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['scribe.js-ocr', '@scribe.js/tesseract.js', 'canvaskit-wasm'],
  },
  // Increase timeout for API routes (Vercel free tier max is 60s, Pro is 300s)
  // This helps with large PDF processing
}

module.exports = nextConfig
