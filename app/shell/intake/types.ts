// What the agent asks (proto intake set) and what the page keeps while the user answers.
export type IntakeOption = { id: string; label: string; sub?: string; demo?: { html?: string; image?: string }; files?: false }
export type IntakeQuestion = { id: string; title: string; why?: string; kind: 'one' | 'many' | 'text'; options?: IntakeOption[]; placeholder?: string; files?: boolean }
export type Intake = { id: string; status: 'open' | 'answered'; ask?: string; title?: string; questions: IntakeQuestion[] }

/** A file the user dropped: its small picture is made while the full file waits to be sent. */
export type Attach = { id: string; name: string; type: string; url: string; thumb?: string; file: File }
/** Answers by question id: option ids, '+their own words', or ['*'] for "Let Claude decide". */
export type Answers = Record<string, string[]>
/** Files by bucket: the question id, or `<question>:<option>` for the card a file was dropped on. */
export type Files = Record<string, Attach[]>
