// Scoped registry actions, including a callback that republishes during reset.
// Run from the browser smoke harness so this exercises the served TypeScript module.
export async function tweaksRegistryChecks({ local, openPage, fail }) {
  const page = await openPage(local)
  try {
    const result = await page.run(`(async () => {
      const { tweaks, isChanged } = await import('/shell/tweaks.ts')
      const host = document.createElement('div'), other = document.createElement('div')
      const calls = [], assert = (ok, why) => { if (!ok) throw new Error(why) }
      let notifications = 0
      const unsubscribe = tweaks.subscribe(() => notifications++)
      const fields = () => [
        { id: 'color', label: 'Theme color', kind: 'color', value: '#123456', defaultValue: '#abcdef', set: value => calls.push(['color', value]) },
        { id: 'state', label: 'State', kind: 'select', value: 'Empty', defaultValue: 'Full', options: ['Full', 'Empty'], set: value => calls.push(['state', value]) },
        { id: 'long', label: 'Long text', kind: 'toggle', value: true, defaultValue: false, set: value => calls.push(['long', value]) },
      ]
      try {
        const first = fields()
        tweaks.set(host, first)
        const notified = notifications
        const latest = fields()
        latest[0].set = value => calls.push(['latest-color', value])
        tweaks.set(host, latest)
        assert(notifications === notified, 'a callback-only render notified subscribers')
        assert(tweaks.of(host)[0] === latest[0], 'latest callbacks were not retained')
        assert(tweaks.change(host, 'color', '#654321'), 'valid color rejected')
        assert(calls[0][0] === 'latest-color', 'change used a stale setter')
        assert(tweaks.change(host, 'state', 'Full'), 'valid option rejected')
        assert(tweaks.change(host, 'long', false), 'valid boolean rejected')
        const before = calls.length
        for (const [id, value] of [['color', '#fff'], ['color', 'red'], ['color', true], ['state', 'Missing'], ['state', false], ['long', 'false'], ['missing', false]]) {
          assert(!tweaks.change(host, id, value), 'invalid change accepted: ' + id + ' ' + value)
        }
        assert(!tweaks.change(null, 'color', '#654321') && calls.length === before, 'invalid change called a setter')
        assert(isChanged(latest[0]) && !isChanged({ ...latest[0], value: '#abcdef' }), 'changed count did not compare explicit defaults')
        assert(!isChanged({ ...latest[0], value: '#ABCDEF' }), 'hex casing counted the default color as changed')
        tweaks.reset(host, 'state')
        assert(JSON.stringify(calls.slice(before)) === JSON.stringify([['state', 'Full']]), 'single-field reset changed another field')
        const untouched = []
        tweaks.set(other, [{ ...latest[0], set: value => untouched.push(value) }])
        const resetting = fields()
        resetting[0].set = value => { calls.push(['reset-color', value]); tweaks.set(host, []) }
        tweaks.set(host, resetting)
        const resetAt = calls.length
        tweaks.reset(host)
        assert(JSON.stringify(calls.slice(resetAt)) === JSON.stringify([['reset-color', '#abcdef'], ['state', 'Full'], ['long', false]]), 'reset lost initiating fields when a setter republished')
        assert(untouched.length === 0 && tweaks.of(other).length === 1, 'reset affected a different host')
        tweaks.drop(host)
        assert(!tweaks.change(host, 'color', '#654321') && tweaks.of(host).length === 0, 'dropped host remained actionable')
        return 'ok'
      } finally { tweaks.drop(host); tweaks.drop(other); unsubscribe() }
    })().catch(error => error.message)`)
    if (result !== 'ok') fail(`tweaks registry: ${result}`)
    console.log('\nOK: Tweaks uses latest setters, validates values and resets only its initiating host')
  } finally { page.close() }
}
