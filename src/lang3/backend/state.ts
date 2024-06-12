import { Value } from "./value";

export type Opcode = 'NOP';

export class Bytecode {
  readonly opcodes: Opcode[];
  constructor(opcodes: Opcode[]) {
    this.opcodes = opcodes;
  }
}

export class StackFrame {
  readonly code: Bytecode[];
  readonly variables = new Map<string, Value>();
  /** instruction pointer */ ip: number = 0;

  constructor(code: Bytecode[]) {
    this.code = code;
  }
}

export class State {
  readonly stack: StackFrame[] = [];
}
