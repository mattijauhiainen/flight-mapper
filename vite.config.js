import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,          // bind 0.0.0.0 so the meshnet interface is reachable
        port: 4000,
        strictPort: true,
        open: false,
        // Vite rejects requests whose Host header isn't localhost/an IP.
        allowedHosts: ['.nord']
    },
    // The dep optimizer doesn't emit maplibre's worker chunk, so the map's
    // worker 404s. Serve the package's own ESM build instead.
    optimizeDeps: {
        exclude: ['maplibre-gl']
    }
});
