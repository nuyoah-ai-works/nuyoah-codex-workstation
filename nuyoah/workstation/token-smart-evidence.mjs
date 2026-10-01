import { SkillHistory } from './skill-history.mjs';

export class TokenSmartEvidence {
  constructor(options = {}) { this.history = options.history || new SkillHistory(options); }
  async view(id) {
    const result = await this.history.view(id);
    const skill = result.skills.find(item => item.name === 'token-smart');
    if (skill) return { status: 'read', readAt: skill.readAt };
    return result.status === 'ready' ? { status: 'not_observed', readAt: null } : { status: 'unavailable' };
  }
}
