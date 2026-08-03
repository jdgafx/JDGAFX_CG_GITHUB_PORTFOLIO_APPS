// Minimal ambient surface for the Netlify Functions runtime, so the functions
// type-check without depending on a transitive @types/node install.
declare const process: {
  env: Record<string, string | undefined>
}
