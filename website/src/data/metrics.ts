export interface Metric {
  value: string;
  label: string;
}

export const primaryMetrics: Metric[] = [
  { value: '10', label: 'MCP tools' },
  { value: '5', label: 'Enablement levels' },
  { value: '6', label: 'Core skills' },
  { value: '4', label: 'Trace primitives' },
];

export const secondaryMetrics: Metric[] = [
  { value: '1,102', label: 'Tests passing' },
  { value: 'MIT', label: 'Licensed' },
  { value: '\u2265 18', label: 'Node.js' },
  { value: 'Local-first', label: 'By default' },
];
