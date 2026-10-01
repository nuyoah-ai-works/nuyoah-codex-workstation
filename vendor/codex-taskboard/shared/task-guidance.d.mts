export interface TaskGuidanceInput {
  identifier?: string;
  projectId?: string;
  title?: string;
  description?: string;
  status?: string;
}

export interface TaskGuidance {
  description: string;
  stage: string;
  nextAction: string;
  suggestions: string[];
}

export function taskGuidance(task: TaskGuidanceInput): TaskGuidance;
export function buildTaskExecutionPrompt(input: {
  task: TaskGuidanceInput;
  projectName?: string;
  workspacePath?: string;
  suggestion?: string;
}): string;
