/**
 * A stand-in for the @netlify/blobs module. Tests mock the module with this, so the real store
 * adapter runs against memory and nothing reaches Netlify. Lists return two keys per page. Conditional
 * writes (onlyIfNew, onlyIfMatch) follow the real semantics: a refused write returns modified false.
 */
export function fakeBlobsModule() {
  const values = new Map<string, string>()
  const tags = new Map<string, string>()
  let counter = 0
  const put = (key: string, value: string) => {
    values.set(key, value)
    counter += 1
    tags.set(key, `etag-${counter}`)
  }
  const store = {
    async get(key: string) {
      return values.has(key) ? (values.get(key) as string) : null
    },
    async getWithMetadata(key: string) {
      return values.has(key) ? { data: values.get(key) as string, etag: tags.get(key), metadata: {} } : null
    },
    async set(key: string, value: string, options: { onlyIfNew?: boolean; onlyIfMatch?: string } = {}) {
      if (options.onlyIfNew && values.has(key)) return { modified: false }
      if (options.onlyIfMatch !== undefined && (!values.has(key) || tags.get(key) !== options.onlyIfMatch)) return { modified: false }
      put(key, value)
      return { modified: true, etag: tags.get(key) }
    },
    async delete(key: string) {
      values.delete(key)
      tags.delete(key)
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
