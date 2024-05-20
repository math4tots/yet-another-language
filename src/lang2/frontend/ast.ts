import { Range } from "./lexer";


export type TypeExpression = Name;

export type Expression = NilLiteral |
  BoolLiteral |
  NumberLiteral |
  StringLiteral |
  Name;

export type Statement = ExpressionStatement |
  Block |
  If |
  While;


export class NilLiteral {
  readonly range: Range;

  constructor(range: Range) {
    this.range = range;
  }
}

export class BoolLiteral {
  readonly range: Range;
  readonly value: boolean;

  constructor(range: Range, value: boolean) {
    this.range = range;
    this.value = value;
  }
}

export class NumberLiteral {
  readonly range: Range;
  readonly value: number;

  constructor(range: Range, value: number) {
    this.range = range;
    this.value = value;
  }
}

export class StringLiteral {
  readonly range: Range;
  readonly value: string;

  constructor(range: Range, value: string) {
    this.range = range;
    this.value = value;
  }
}

export class Name {
  readonly range: Range;
  readonly value: string;

  constructor(range: Range, value: string) {
    this.range = range;
    this.value = value;
  }
}

export class ExpressionStatement {
  readonly range: Range;
  readonly expression: Expression;

  constructor(range: Range, expression: Expression) {
    this.range = range;
    this.expression = expression;
  }
}

export class Block {
  readonly range: Range;
  readonly statements: Statement[];

  constructor(range: Range, statements: Statement[]) {
    this.range = range;
    this.statements = statements;
  }
}

export class IfClause {
  readonly range: Range;
  readonly condition: Expression;
  readonly body: Block;

  constructor(range: Range, condition: Expression, body: Block) {
    this.range = range;
    this.condition = condition;
    this.body = body;
  }
}

export class If {
  readonly range: Range;
  readonly ifClauses: IfClause[];
  readonly elseClause: Block | undefined;

  constructor(range: Range, ifClauses: IfClause[], elseClause: Block | undefined) {
    this.range = range;
    this.ifClauses = ifClauses;
    this.elseClause = elseClause;
  }
}

export class While {
  readonly range: Range;
  readonly condition: Expression;
  readonly body: Block;

  constructor(range: Range, condition: Expression, body: Block) {
    this.range = range;
    this.condition = condition;
    this.body = body;
  }
}
