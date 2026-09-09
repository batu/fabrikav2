# public/

Vite static-serve root: files here are copied verbatim to the build output at the
site root, untouched by the bundler. Use it for runtime-loaded static assets
(favicons, fonts, audio, level imagery served by URL). Design-system assets that
flow through the sheet round-trip belong in `design/assets/`; `public/` is for
plain static files the game fetches at runtime.
