export type HostingTarget = 'vps1' | 'vps2'
export type HostingProjectName = 'sistemas' | 'blogs' | 'projetos'

export const HOSTING_PROJECT_OPTIONS: readonly { projectName: HostingProjectName; target: HostingTarget; label: string }[] = [
  { projectName: 'sistemas', target: 'vps2', label: 'sistemas — VPS2' },
  { projectName: 'blogs', target: 'vps2', label: 'blogs — VPS2' },
  { projectName: 'projetos', target: 'vps1', label: 'projetos — VPS1' },
]

export function validateHostingProject(projectName: unknown, target: unknown): projectName is HostingProjectName {
  return HOSTING_PROJECT_OPTIONS.some((option) => option.projectName === projectName && option.target === target)
}
