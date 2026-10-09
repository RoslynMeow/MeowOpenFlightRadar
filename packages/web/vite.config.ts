import { defineConfig } from 'vite';

// 开发时把 /api 与 /event 代理到本地 server（8787），避免跨域与 SSE 复杂配置。
// 若部署到其它地址，可用 VITE_API_BASE 指定服务端绝对地址。
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/event': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
