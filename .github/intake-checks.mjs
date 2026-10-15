// Questions the agent asks before it builds (proto intake set): validated at the command, shown to
// the page by the server, answered with a POST, and handed back through the inbox as an intake batch
// with the dropped files saved beside it. Needs the server but no page.
// Runs in the smoke suite.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function intakeChecks({ proto, app, local, fail }) {
  const file = join(app, '.proto', 'q-intake.json')
  const q = {
    ask: 'A website for my mom, she is a dentist',
    questions: [
      { id: 'job', kind: 'one', title: 'Main job?', why: 'Decides the top', options: [{ id: 'book', label: 'Bookings', demo: { html: '<div style="padding:8px">9:00</div>' } }, { id: 'calm', label: 'Calm' }] },
      { id: 'have', kind: 'many', files: true, title: 'What exists?', options: [{ id: 'logo', label: 'A logo' }, { id: 'reviews', label: 'Reviews', files: false }] },
      { id: 'more', kind: 'text', title: 'Anything else?' },
    ],
  }
  const write = v => writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v))
  const post = (path, body) => fetch(`${local}__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  // What the command turns down.
  write('not json')
  if (!/not JSON/.test(proto(['intake', 'set', file], { ok: false }))) fail('proto intake set should say a file that is not JSON is not JSON')
  write({ ...q, questions: [{ ...q.questions[0], kind: 'some' }] })
  if (!/kind is one/.test(proto(['intake', 'set', file], { ok: false }))) fail('proto intake set should explain a question kind that is none of one, many, text')
  write({ ...q, questions: [{ ...q.questions[0], options: [{ id: 'a', label: 'A', demo: { image: '../outside.png' } }, { id: 'b', label: 'B' }] }] })
  if (!/src\/assets/.test(proto(['intake', 'set', file], { ok: false }))) fail('a demonstration image outside src/assets/ should be refused')
  write({ ...q, questions: [q.questions[0], q.questions[0]] })
  if (!/used twice/.test(proto(['intake', 'set', file], { ok: false }))) fail('two questions with one id should be refused')

  // Open: the page is told, and a second set waits for the answers unless it replaces them.
  write(q)
  proto(['intake', 'set', file])
  if (!/open: 3 questions/.test(proto(['intake', 'status'], { stdout: true }))) fail('proto intake status should say 3 questions are open')
  if (!/already open/.test(proto(['intake', 'set', file], { ok: false }))) fail('questions already open should not be replaced without --replace')
  let status = await (await fetch(`${local}__proto/status`)).json()
  const open = status.inbox?.intake
  if (open?.status !== 'open' || open.questions.length !== 3 || open.questions[0].options[0].demo?.html === undefined) fail(`the page should be told the open questions, demonstrations included: ${JSON.stringify(open)}`)

  // Answers for another intake, or none open, are turned away.
  const stale = await post('intake', { id: 'other', answers: {} })
  if (stale.status !== 409) fail(`answers for another intake should be refused with 409, got ${stale.status}`)

  // Answered: a batch with the answers, and the file saved where it says.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const sent = await post('intake', {
    id: open.id, answers: { job: ['book'], have: ['logo', '+Instagram page'], more: ['Dr. Ruth Levi'], nope: ['x'] }, decided: [],
    files: [{ question: 'have:logo', name: 'logo.png', dataUrl: png }, { question: 'ghost', name: 'x.png', dataUrl: png }],
  })
  if (!sent.ok) fail(`the answers should be taken: ${sent.status} ${await sent.text()}`)
  status = await (await fetch(`${local}__proto/status`)).json()
  if (status.inbox.intake?.status !== 'answered') fail(`the questions should be marked answered: ${JSON.stringify(status.inbox.intake?.status)}`)
  const again = await post('intake', { id: open.id, answers: { job: ['calm'] } })
  if (again.status !== 409) fail(`answering twice should be refused with 409, got ${again.status}`)

  const heard = proto(['inbox'], { stdout: true })
  for (const want of ['intake: the answers to your questions', 'Main job?', '-> Bookings', 'A logo, Instagram page (their own words)', 'Dr. Ruth Levi', 'A logo: ']) {
    if (!heard.includes(want)) fail(`proto inbox should print the answers (${want}): ${heard}`)
  }
  if (/ghost|nope/.test(heard)) fail(`an answer or file for a question that was never asked should be left out: ${heard}`)
  const saved = heard.match(/A logo: (\S+1-logo\.png)/)?.[1]
  if (!saved || !existsSync(saved)) fail(`the dropped file should be saved beside the batch: ${saved}`)
  const batch = (heard.match(/batch (\S+) ·/) || [])[1]
  proto(['reply', `${batch}/1`, 'Planning from this', '--done'])
  if (!/answered/.test(proto(['intake', 'status'], { stdout: true }))) fail('proto intake status should say the questions were answered')
  proto(['intake', 'clear'])
  if (!/no questions/.test(proto(['intake', 'status'], { stdout: true }))) fail('proto intake clear should take the questions away')
}
