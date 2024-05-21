import { Range } from "./lexer";

export class Location {
  readonly uri: string;
  readonly range: Range;

  constructor(uri: string, range: Range) {
    this.uri = uri;
    this.range = range;
  }
}
