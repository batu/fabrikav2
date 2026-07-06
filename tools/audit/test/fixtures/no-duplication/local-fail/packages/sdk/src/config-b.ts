// VIOLATION (b): same local helper name in a second file.
function parseEnv(): number { return 2; }
export const B = parseEnv();
