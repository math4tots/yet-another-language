import { Range } from "./lexer";


export type Expression = Name;



export class Name {
  readonly range: Range;
  readonly value: string;

  constructor(range: Range, value: string) {
    this.range = range;
    this.value = value;
  }
}
