// Preload: mock 'server-only' så CLI-scripts kan importere server-only moduler direkte
// Bruges som: npx tsx --import ./scripts/mock-server-only.ts <script>
import Module from "module"

// @ts-expect-error private API
const originalLoad = Module._load
// @ts-expect-error private API
Module._load = function (request: string, ...args: unknown[]) {
    if (request === "server-only") return {}
    return originalLoad.call(this, request, ...args)
}
