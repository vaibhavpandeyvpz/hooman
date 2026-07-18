import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  AcpProcessSupervisor,
  SessionCoordinator,
  type AcpLaunchSpec,
} from "../acp-client/index.js";
import type {
  PromptContentBlock,
  SessionConfigOption,
  SessionNotification,
} from "../shared/session-types.js";

export type PermissionRequester = (
  projectId: string,
  params: {
    sessionId: string;
    options: Array<{ optionId: string; name: string }>;
  },
) => Promise<string>;

type Project = {
  id: string;
  cwd: string;
  supervisor: AcpProcessSupervisor;
  coordinator: SessionCoordinator;
};

/**
 * Owns one supervised ACP process per canonical project root (per the plan's
 * §5.2 process model: session storage and bootstrap resolution are
 * process/cwd scoped today, so unrelated projects must not share a process).
 */
export class ProjectRegistry {
  #projects = new Map<string, Project>();
  #launcher: (cwd: string) => AcpLaunchSpec;
  #requestPermission: PermissionRequester;

  constructor(
    launcher: (cwd: string) => AcpLaunchSpec,
    requestPermission: PermissionRequester,
  ) {
    this.#launcher = launcher;
    this.#requestPermission = requestPermission;
  }

  /** Starts (or reuses) the supervised ACP process for a project root; does not create a session. */
  async openProject(cwd: string): Promise<Project> {
    const canonical = await realpath(cwd);
    const existing = [...this.#projects.values()].find(
      (p) => p.cwd === canonical,
    );
    if (existing) return existing;
    const id = randomUUID();
    const supervisor = new AcpProcessSupervisor(
      this.#launcher(canonical),
      async (method, params) => {
        if (method === "session/request_permission") {
          const p = params as {
            sessionId: string;
            options: Array<{ optionId: string; name: string }>;
          };
          const optionId = await this.#requestPermission(id, p);
          return { outcome: { outcome: "selected", optionId } };
        }
        throw new Error(`Unhandled agent request: ${method}`);
      },
    );
    await supervisor.start();
    const project: Project = {
      id,
      cwd: canonical,
      supervisor,
      coordinator: new SessionCoordinator(supervisor),
    };
    this.#projects.set(id, project);
    return project;
  }

  async newSession(
    projectId: string,
  ): Promise<{ sessionId: string; configOptions?: SessionConfigOption[] }> {
    const project = this.#require(projectId);
    return project.coordinator.createSession(project.cwd);
  }

  async listSessions(projectId: string) {
    const project = this.#require(projectId);
    return project.coordinator.listSessions(project.cwd);
  }

  async loadSession(
    projectId: string,
    sessionId: string,
  ): Promise<{ configOptions?: SessionConfigOption[] }> {
    const project = this.#require(projectId);
    return project.coordinator.loadSession(project.cwd, sessionId);
  }

  subscribe(
    projectId: string,
    sessionId: string,
    listener: (n: SessionNotification) => void,
  ): () => void {
    return this.#require(projectId).coordinator.onSessionUpdate(
      sessionId,
      listener,
    );
  }

  async closeSession(projectId: string, sessionId: string): Promise<void> {
    await this.#require(projectId).coordinator.closeSession(sessionId);
  }

  async deleteSession(projectId: string, sessionId: string): Promise<void> {
    await this.#require(projectId).coordinator.deleteSession(sessionId);
  }

  get(projectId: string): Project | undefined {
    return this.#projects.get(projectId);
  }

  /**
   * Removes a project from the sidebar for this run: stops its supervised
   * ACP process and drops it from the registry. Non-destructive — session
   * history stays on disk, so reopening the same folder (`openProject`)
   * lists the same sessions again. A no-op if the project is already gone.
   */
  closeProject(projectId: string): void {
    const project = this.#projects.get(projectId);
    if (!project) return;
    project.supervisor.stop();
    this.#projects.delete(projectId);
  }

  #require(projectId: string): Project {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error(`Unknown project ${projectId}`);
    return project;
  }

  async prompt(
    projectId: string,
    sessionId: string,
    prompt: PromptContentBlock[],
  ): Promise<void> {
    await this.#require(projectId).coordinator.prompt(sessionId, prompt);
  }

  async cancel(projectId: string, sessionId: string): Promise<void> {
    await this.#require(projectId).coordinator.cancel(sessionId);
  }

  async stopShellJob(
    projectId: string,
    sessionId: string,
    jobId: string,
  ): Promise<{ stopped: boolean }> {
    return this.#require(projectId).coordinator.stopShellJob(sessionId, jobId);
  }

  async setConfigOption(
    projectId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<{ configOptions: SessionConfigOption[] }> {
    return this.#require(projectId).coordinator.setConfigOption(
      sessionId,
      configId,
      value,
    );
  }

  stopAll(): void {
    for (const project of this.#projects.values()) project.supervisor.stop();
    this.#projects.clear();
  }
}
