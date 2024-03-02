import * as ast from './ast';


export const JS_PRELUDE = `
class YALNil {
  isTrue() { return false; }
  toString() { return 'nil'; }
  toRepr() { return 'nil'; }
}
class YALBool {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return this.value; }
  toString() { return this.value ? 'true' : 'false'; }
  toRepr() { return this.value ? 'true' : 'false'; }
}
class YALNumber {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return '' + this.value; }
  toRepr() { return '' + this.value; }
  YAL__add__(rhs) { return new YALNumber(this.value + rhs.value); }
  YAL__sub__(rhs) { return new YALNumber(this.value - rhs.value); }
  YAL__mul__(rhs) { return new YALNumber(this.value * rhs.value); }
  YAL__div__(rhs) { return new YALNumber(this.value / rhs.value); }
  YAL__mod__(rhs) { return new YALNumber(this.value % rhs.value); }
}
class YALString {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return this.value; }
  toRepr() { return JSON.stringify(this.value); }
  YAL__add__(rhs) { return new YALString(this.value + rhs.value); }
  YALget_size() { return this.value.length; }
}
class YALList {
  constructor(value) {
    this.value = value;
  }
  isTrue() { return true; }
  toString() { return '[' + this.value.map(v => v.toString()).join(',') + ']'; }
  toRepr() { return '[' + this.value.map(v => v.toString()).join(',') + ']'; }
  YALget_size() { return this.value.length; }
}
class YALFunction {
  constructor(value, name) {
    this.value = value;
    this.name = name || value.name;
  }
  isTrue() { return true; }
  toString() { return '<function ' + this.name + '>'; }
  toRepr() { return '<function ' + this.name + '>'; }
  YAL__call__(...args) { return this.value(...args); }
}
const YALnil = new YALNil();
const YALtrue = new YALBool(true);
const YALfalse = new YALBool(false);
const YALprint = new YALFunction(x => (console.log(x.toString()), YALnil), 'print');
const YALstr = new YALFunction(x => new YALString(x.toString()), 'str');
const YALrepr = new YALFunction(x => new YALString(x.toRepr()), 'repr');
`;

export class JSCodegen implements ast.NodeVisitor<void> {
  out: string = '';

  visitFile(n: ast.File): void {
    for (const statement of n.statements) {
      statement.accept(this);
    }
  }
  visitNilLiteral(n: ast.NilLiteral): void {
    this.out += 'YALnil';
  }
  visitBooleanLiteral(n: ast.BooleanLiteral): void {
    this.out += n.value ? 'YALtrue' : 'YALfalse';
  }
  visitNumberLiteral(n: ast.NumberLiteral): void {
    this.out += `new YALNumber(${n.value})`;
  }
  visitStringLiteral(n: ast.StringLiteral): void {
    this.out += `new YALString(${JSON.stringify(n.value)})`;
  }
  visitIdentifierNode(n: ast.IdentifierNode): void {
    this.out += `YAL${n.name}`;
  }
  visitAssignment(n: ast.Assignment): void {
    this.out += `(YAL${n.identifier.name} = `;
    n.value.accept(this);
    this.out += ')';
  }
  visitListDisplay(n: ast.ListDisplay): void {
    this.out += 'new YALList([';
    for (let i = 0; i < n.values.length; i++) {
      if (i > 0) {
        this.out += ',';
      }
      n.values[i].accept(this);
    }
    this.out += '])';
  }
  visitFunctionDisplay(n: ast.FunctionDisplay): void {
    const parameters = n.parameters.map(p => `YAL${p.identifier.name}`).join(',');
    this.out += `new YALFunction((${parameters})=>{`;
    n.body.accept(this);
    this.out += 'return YALnil;})';
  }
  visitMethodCall(n: ast.MethodCall): void {
    n.owner.accept(this);
    this.out += `.YAL${n.identifier.name}(`;
    for (let i = 0; i < n.args.length; i++) {
      if (i > 0) this.out += ',';
      n.args[i].accept(this);
    }
    this.out += ')';
  }
  visitNew(n: ast.New): void {
    this.out += `(new YAL${n.type.identifier.name}(`;
    for (let i = 0; i < n.args.length; i++) {
      if (i > 0) this.out += ',';
      n.args[i].accept(this);
    }
    this.out += '))';
  }
  visitLogicalAnd(n: ast.LogicalAnd): void {
    this.out += '(';
    n.lhs.accept(this);
    this.out += '.isTrue()&&';
    n.rhs.accept(this);
    this.out += '.isTrue())?YALtrue:YALfalse';
  }
  visitLogicalOr(n: ast.LogicalOr): void {
    this.out += '(';
    n.lhs.accept(this);
    this.out += '.isTrue()||';
    n.rhs.accept(this);
    this.out += '.isTrue())?YALtrue:YALfalse';
  }
  visitConditional(n: ast.Conditional): void {
    this.out += '(';
    n.condition.accept(this);
    this.out += '.isTrue()?';
    n.lhs.accept(this);
    this.out += ':';
    n.rhs.accept(this);
    this.out += ')';
  }
  visitEmptyStatement(n: ast.EmptyStatement): void { }
  visitExpressionStatement(n: ast.ExpressionStatement): void {
    n.expression.accept(this);
    this.out += ';';
  }
  visitBlock(n: ast.Block): void {
    this.out += '{';
    for (const statement of n.statements) {
      statement.accept(this);
    }
    this.out += '}';
  }
  visitDeclaration(n: ast.Declaration): void {
    const storageClass = n.isMutable ? 'let' : 'const';
    this.out += `${storageClass} YAL${n.identifier.name}`;
    if (n.value) {
      this.out += '=';
      n.value.accept(this);
    }
    this.out += ';';
  }
  visitIf(n: ast.If): void {
    this.out += 'if(';
    n.condition.accept(this);
    this.out += '.isTrue())';
    n.lhs.accept(this);
    if (n.rhs) {
      this.out += 'else';
      n.rhs.accept(this);
    }
  }
  visitWhile(n: ast.While): void {
    this.out += 'while(';
    n.condition.accept(this);
    this.out += '.isTrue())';
    n.body.accept(this);
  }
  visitReturn(n: ast.Return): void {
    this.out += 'return ';
    n.value.accept(this);
    this.out += ';';
  }
  visitClassDefinition(n: ast.ClassDefinition): void {
    this.out += `class YAL${n.identifier.name}{`;
    this.out += 'isTrue(){return true;}';
    this.out += `toString(){return "<${n.identifier.name} instance>"; }`;
    this.out += `toRepr(){return this.toString(); }`;
    const constructorFields: string[] = [];
    const initialiedFields: [string, ast.Expression][] = [];
    const readFields: string[] = [];
    const writeFields: string[] = [];
    for (const statement of n.statements) {
      if (statement instanceof ast.Declaration) {
        if (statement.value instanceof ast.FunctionDisplay) {
          // method
          const parameters =
            statement.value.parameters.map(p => `YAL${p.identifier.name}`).join(',');
          this.out += `YAL${statement.identifier.name}(${parameters}){const YALthis = this;`;
          statement.value.body.accept(this);
          this.out += 'return YALnil;}';
        } else {
          // field
          readFields.push(statement.identifier.name);
          if (statement.isMutable) {
            writeFields.push(statement.identifier.name);
          }
          if (statement.value) {
            initialiedFields.push([statement.identifier.name, statement.value]);
          } else {
            constructorFields.push(statement.identifier.name);
          }
        }
      }
    }
    for (const readField of readFields) {
      this.out += `YALget_${readField}(){return this.field${readField};}`;
    }
    for (const writeField of writeFields) {
      this.out += `YALset_${writeField}(x){return this.field${writeField} = x;}`;
    }
    const constructorParameters = constructorFields.map(f => `YAL${f}`);
    this.out += `constructor(${constructorParameters}){`;
    for (const normalField of constructorFields) {
      this.out += `this.field${normalField} = YAL${normalField};`;
    }
    for (const [name, expr] of initialiedFields) {
      this.out += `this.field${name} =`;
      expr.accept(this);
      this.out += ';';
    }
    this.out += '}}';
  }
  visitInterfaceDefinition(n: ast.InterfaceDefinition): void { }
  visitImport(n: ast.Import): void { }
}
