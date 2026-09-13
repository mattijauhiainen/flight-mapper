import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,          // bind 0.0.0.0 so the meshnet interface is reachable
        port: 4000,
        strictPort: true,
        open: false,
        // Vite rejects requests whose Host header isn't localhost/an IP.
        allowedHosts: ['.nord']
    }
});
