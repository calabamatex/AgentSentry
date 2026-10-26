export interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

export const navLinks: NavLink[] = [
  { label: 'AgentSentry', href: '/agentsentry' },
  { label: 'Stigmergy', href: '/stigmergy' },
  { label: 'Docs', href: 'https://github.com/calabamatex/AgentSentry#readme', external: true },
  { label: 'GitHub', href: 'https://github.com/calabamatex/AgentSentry', external: true },
];

export const wordmark = 'agenticmgmt';
