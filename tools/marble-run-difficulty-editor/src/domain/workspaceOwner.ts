import { EditorWorkspace, type EditorWorkspaceOptions } from './workspace.ts';

export type WorkspaceFactory = (options?: EditorWorkspaceOptions) => EditorWorkspace;

/** Keeps workspace construction outside React's deliberately repeatable render phase. */
export class WorkspaceOwner {
  private workspace: EditorWorkspace | null = null;

  constructor(private readonly factory: WorkspaceFactory = (options) => new EditorWorkspace(options)) {}

  current(): EditorWorkspace {
    this.workspace ??= this.factory();
    return this.workspace;
  }
}

export const defaultWorkspaceOwner = new WorkspaceOwner();
