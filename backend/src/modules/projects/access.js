export function createProjectAccessService(projects) {
  return (projectId, userId) => projects.getAccess(projectId, userId)
}

export function canEditProject(access) {
  return access?.role === "editor"
}
