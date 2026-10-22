/** Shared client/server contract for the CLI executor runbooks. */
export interface Runbook {
  id: string;
  label: string;
  template: string;
  description: string;
  risky: boolean;
}
