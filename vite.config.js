import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
    },
    build: {
        rolldownOptions: {
            external: ['maplibre-gl']
        }
    },
    plugins: [serveMaplibreModules()]
});

function serveMaplibreModules() {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('maplibre-gl/package.json');
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const distDir = join(dirname(packageJsonPath), 'dist');
    const publicDir = `maplibre/${version}`;
    const moduleFiles = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs'];
    let base = '/';

    return {
        name: 'serve-maplibre-modules',
        apply: 'build',
        configResolved(config) {
            base = config.base;
        },
        generateBundle() {
            for (const fileName of moduleFiles) {
                this.emitFile({
                    type: 'asset',
                    fileName: `${publicDir}/${fileName}`,
                    source: readFileSync(join(distDir, fileName))
                });
            }
        },
        transformIndexHtml() {
            return [
                {
                    tag: 'script',
                    attrs: { type: 'importmap' },
                    children: JSON.stringify({ imports: { 'maplibre-gl': `${base}${publicDir}/maplibre-gl.mjs` } }),
                    injectTo: 'head-prepend'
                },
                ...['maplibre-gl.mjs', 'maplibre-gl-shared.mjs'].map((fileName) => ({
                    tag: 'link',
                    attrs: { rel: 'modulepreload', href: `${base}${publicDir}/${fileName}` },
                    injectTo: 'head'
                }))
            ];
        }
    };
}
