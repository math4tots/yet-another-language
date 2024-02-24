import { Location } from "./ast";

export const errorStack: Location[] = [];

export class RuntimeError {
  message: string;
  stack: Location[];
  constructor(message: string, location: Location | null = null) {
    this.message = message;
    this.stack = Array.from(errorStack);
    if (location) {
      this.stack.push(location);
    }
  }
  toString() {
    const locs = this.stack.map(
      loc => `  ${loc.uri}:${loc.range.start.line}:${loc.range.start.column}\n`);
    return `${this.message}\n${locs.join('')}`;
  }
}
