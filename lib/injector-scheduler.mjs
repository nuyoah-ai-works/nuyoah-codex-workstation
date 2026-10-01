// Each service owns at most one in-flight operation. Slow catalog/Skill work
// must not hold the renderer request pump or duplicate itself on every tick.
export function createInjectorScheduler({ onError = () => {} } = {}) {
  const jobs = new Map();
  return {
    busy: name => jobs.has(name),
    run(name, operation) {
      if (jobs.has(name)) return jobs.get(name);
      const job = Promise.resolve().then(operation).catch(error => { onError(name, error); })
        .finally(() => { if (jobs.get(name) === job) jobs.delete(name); });
      jobs.set(name, job);
      return job;
    },
    async settle() { await Promise.all([...jobs.values()]); },
  };
}
