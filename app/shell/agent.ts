/** Current session host, distinct from the author recorded on each reply. */
export type Agent = 'claude' | 'codex' | 'agent'
export const AGENT: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', agent: 'Agent' }
export const agentName = (by?: string) => by === 'claude' || by === 'codex' ? AGENT[by] : AGENT.agent
