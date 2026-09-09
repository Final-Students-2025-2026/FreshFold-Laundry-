import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import siteMetadata from './vite/site-metadata';

/**
 * Config is a function so it can read `.env` itself.
 *
 * Vite only ever puts `VITE_`-prefixed variables on `import.meta.env`; it does
 * not populate `process.env` from a `.env` file at all. This config reads
 * `API_URL`, `GOOGLE_MAPS_PLATFORM_KEY` and `DISABLE_HMR`, and reading them
 * off `process.env` meant they only worked when exported in the shell —
 * silently doing nothing when set in `apps/web/.env`, which is exactly where
 * `.env.example` tells you to put them. `loadEnv` with an empty prefix reads
 * the file the way the template promises.
 *
 * The shell still wins, which is what a deployment or CI expects.
 */
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env };
  const apiTarget = env.API_URL || 'http://127.0.0.1:4000';
  const disableHmr = env.DISABLE_HMR === 'true';

  /**
   * The origin this build will be served from.
   *
   * It goes into the canonical tag, the share card's `og:url`, the sitemap and
   * the structured data — all four of which are claims about where the real
   * site lives, and all four of which are actively harmful when wrong: a
   * preview deploy that claims to be the canonical one is a preview deploy in
   * the search results.
   *
   * There is no correct default, so the placeholder announces itself. It is
   * the same value as the server's `APP_URL` and they should be set together.
   */
  const siteUrl = (env.SITE_URL || 'https://freshfold.com').replace(/\/$/, '');
  if (!env.SITE_URL && command === 'build') {
    console.warn(
      `\n  ! SITE_URL is not set, so the build is claiming ${siteUrl} as its canonical origin.\n` +
        '    Set it to the domain this deploy actually serves — the same value as the\n' +
        "    server's APP_URL — or the share card and the sitemap will point somewhere else.\n"
    );
  }

  return {
    plugins: [react(), tailwindcss(), siteMetadata({ siteUrl })],
    define: {
      // A Maps JavaScript key is public by nature — it ships in the bundle and
      // is protected by an HTTP referrer restriction, not by secrecy. Nothing
      // else from the environment is injected here.
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(
        env.GOOGLE_MAPS_PLATFORM_KEY || ''
      ),
      // Not a secret at all — a Map ID is a public style handle — but it
      // travels with the key, so it gets the same two spellings.
      'process.env.GOOGLE_MAPS_MAP_ID': JSON.stringify(env.GOOGLE_MAPS_MAP_ID || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Consumed as TypeScript source out of the workspace, so there is no
        // build step between editing shared domain code and seeing it here.
        '@freshfold/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      },
    },
    optimizeDeps: {
      exclude: ['@freshfold/core'],
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * Vendor chunks, named explicitly.
           *
           * The lazy imports in `App.tsx` split our own screens out of the first
           * load, but they are not enough on their own: a module reachable from
           * two different dynamic imports gets hoisted to their common ancestor,
           * which is the entry. The Google Maps bindings are needed
           * by both the booking form and the client portal, so they ended up
           * back in the chunk every marketing visitor downloads.
           *
           * Naming them here pins each to its own file, fetched when something
           * that needs it is. The map libraries are the ones that matter — they
           * are the largest single thing on the site and no visitor who does not
           * open a map has any use for them.
           *
           * `react` is split for the opposite reason: everything needs it, so a
           * chunk of its own is one that can stay in a browser cache across a
           * deploy that only changed our code.
           */
          manualChunks: {
            react: ['react', 'react-dom'],
            motion: ['motion'],
            maps: ['@vis.gl/react-google-maps'],
          },
        },
      },
      // The entry is what this was really about; a warning that fires on a
      // deliberately-large vendor chunk is one people learn to scroll past.
      chunkSizeWarningLimit: 700,
    },
    server: {
      port: 3000,
      /**
       * Fail on a busy 3000 rather than quietly moving to 3001.
       *
       * Vite's default is to walk up until it finds a free port, which is the
       * friendlier behaviour for a site that is only ever opened by hand. This
       * one is not: `.vscode/launch.json` points a debugger at 3000, the rider
       * and customer apps derive their own address from a fixed port, and a
       * second `npm run dev` started in a forgotten terminal is a normal way to
       * spend an afternoon. Every one of those fails as something else — a
       * blank tab, an app that cannot reach the API, edits that never appear —
       * because the port moved and only one line of terminal output said so.
       *
       * The cost is that a genuinely occupied 3000 now stops the dev server
       * instead of working around it. That is the point: the occupant is
       * almost always the copy you forgot about.
       */
      strictPort: true,
      // Everything under /api belongs to the dispatch server, which the rider
      // app also talks to. Proxying keeps the browser on one origin in dev.
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // Say out loud when the dispatch server is not there.
          //
          // Without this the failure is silent from both ends: Vite answers the
          // browser with a bare 500, and the app — which queues a failed write
          // and retries later by design — shows the customer a confirmation
          // anyway. A booking then sits in localStorage for as long as the
          // target is down, with nothing in the terminal to say why. That
          // happened for an hour and forty minutes because nothing was
          // listening on 4002.
          configure: (proxy) => {
            let warned = false;
            proxy.on('error', (error: NodeJS.ErrnoException, req, res) => {
              if (!warned) {
                warned = true;
                console.error(
                  `\n  ✖ /api is proxied to ${apiTarget} and nothing answered (${error.code ?? error.message}).\n` +
                    '    Writes will queue in the browser and the UI will still look like it worked.\n' +
                    '    Start the dispatch server, or point API_URL in apps/web/.env at one that is running.\n'
                );
              }
              // Vite's default is an empty-bodied 500. Name the cause instead,
              // so the app can tell "server is down" from "server said no".
              if (!res.headersSent && 'writeHead' in res) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({ error: `dispatch server unreachable at ${apiTarget}`, path: req.url })
                );
              }
            });
            proxy.on('proxyRes', () => {
              warned = false;
            });
          },
        },
      },
      // HMR is disabled in AI Studio via the DISABLE_HMR env var.
      hmr: !disableHmr,
      watch: disableHmr ? null : {},
    },
  };
});
