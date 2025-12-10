/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['scribe.js-ocr', '@scribe.js/tesseract.js', 'canvaskit-wasm'],
  },
}

module.exports = nextConfig
