/**
 * A stand-in for the @netlify/blobs module. Tests mock the module with this, so the real store
 * adapter runs against memory and nothing reaches Netlify. Lists return two keys per page.
 */
export function fakeBlobsModule() {
  const values = new Map<string, string>()
  const store = {
    async get(key: string) {
      return values.has(key) ? (values.get(key) as string) : null
    },
    async set(key: string, value: string) {
      values.set(key, value)
      return { modified: true }
    },
    async delete(key: string) {
      values.delete(key)
    },
    list(options: { prefix?: string; paginate?: boolean }) {
      const keys = [...values.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
      return (async function* pages() {
        for (let i = 0; i < keys.length; i += 2) {
          yield { blobs: keys.slice(i, i + 2).map((key) => ({ key, etag: 'fake' })), directories: [] }
        }
      })()
    },
  }
  return { getStore: () => store, values }
}
