import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const empty = () => ({ quotes: {}, mockOrders: {} });

// File-backed so several MCP server processes and the approval web server see the same orders.
export class FileStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    if (!existsSync(this.file)) return empty();
    return { ...empty(), ...JSON.parse(readFileSync(this.file, "utf8")) };
  }

  update(mutate) {
    const state = this.read();
    const result = mutate(state);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.file);
    return result;
  }
}

export class MemoryStore {
  constructor() {
    this.state = empty();
  }

  read() {
    return structuredClone(this.state);
  }

  update(mutate) {
    return mutate(this.state);
  }
}
