import * as ast from '../frontend/ast';
import { Range, Rangeable } from '../frontend/lexer';
import { Annotation, AnnotationError, Variable } from './annotation';

export type ModuleFinder = (startURI: string, path: string) => Annotation | undefined;

type ExpressionAnnotation = {
  readonly type: any;
  readonly ir: ast.Expression;
};

type StatementAnnotation = {
  readonly ir: ast.Statement;
};

type Scope = { [key: string]: Variable; };

function newScope(parent: Scope | null = null): Scope {
  return Object.create(parent);
}

export function annotate(uri: string, module: ast.ModuleDisplay, moduleFinder: ModuleFinder): Annotation {
  const errors: AnnotationError[] = [...module.errors];

  function error(range: Rangeable, message: string) {
    errors.push(new ast.ParseError(Range.join(range), message));
  }

  const scope = newScope(); // TODO: builtins/globals
  const header: ast.HeaderItem[] = [];
  for (const node of module.header) {
    if (node instanceof ast.StringLiteral) {
      // comments - skip this
    } else if (node instanceof ast.ExportAs) {
      header.push(node);
    } else if (node instanceof ast.ImportAs) {
      const variable = moduleFinder(uri, node.path.value)?.asVariable();
      if (variable) {
        scope[node.name.value] = variable;
      } else {
        error(node.path, `Module ${JSON.stringify(node.path.value)} not found`);
      }
    }
  }
  const statements: ast.Statement[] = [];
  const ir = new ast.ModuleDisplay(module.range, header, statements, module.errors);
  return new Annotation(uri, ir, errors);
}
