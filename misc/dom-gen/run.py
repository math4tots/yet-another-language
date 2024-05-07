"""
A little script to generate YAL bindings from typescript d.ts file
"""
import os
import argparse
import typing

aparser = argparse.ArgumentParser()
aparser.add_argument('command')
args = aparser.parse_args()
COMMAND: str = args.command

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
TS_PATH = os.path.join(SCRIPT_DIR, 'lib.dom.d.ts')


SYMBOLS = {
    '(', ')', '[', ']', '{', '}', '<', '>',
    '=',
    '+', '-',
    '|', '&', '||', '&&',
    '...', '.', ',', ':', ';',
    '=>', '?',
}
SYMBOLS_REVERSE_SORTED = sorted(SYMBOLS, reverse=True)

class Token(typing.NamedTuple):
    i: int
    type: str
    value: str


def lex(s: str) -> typing.List[Token]:
    tokens: typing.List[Token] = []
    i = 0
    while True:
        while i < len(s):
            if s[i].isspace():
                i += 1
                continue
            if s.startswith('//', i):
                while i < len(s) and s[i] != '\n':
                    i += 1
                continue
            if s.startswith('/**/', i) or (s.startswith('/*', i) and not s.startswith('/**', i)):
                i += 2
                while i < len(s) and not s.startswith('*/', i):
                    i += 1
                i += 2
                continue
            break
        if i >= len(s):
            break
        start = i
        if s.startswith('/**', i):
            i += 2
            while i < len(s) and not s.startswith('*/', i):
                i += 1
            i += 2
            tokens.append(Token(i=start, type='COMMENT', value=s[start+3:i-2]))
            continue
        c = s[i]
        if c.isdigit():
            if s.startswith('0x', i):
                i += 2
            while i < len(s) and s[i].isdigit():
                i += 1
            if i < len(s) and s[i] == '.':
                i += 1
            while i < len(s) and s[i].isdigit():
                i += 1
            tokens.append(Token(i=start, type='NUMBER', value=s[start:i]))
            continue
        if c.isalpha() or c == '_':
            while i < len(s) and (s[i].isalnum() or s[i] == '_'):
                i += 1
            tokens.append(Token(i=start, type='NAME', value=s[start:i]))
            continue
        if c in '`"\'':
            i += 1
            while i < len(s) and s[i] != c:
                if s[i] == '\\':
                    i += 1
                i += 1
            i += 1
            tokens.append(Token(i=start, type='STRING', value=s[start:i]))
            continue

        for symbol in SYMBOLS_REVERSE_SORTED:
            if s.startswith(symbol, i):
                i += len(symbol)
                tokens.append(Token(i=start, type=symbol, value=symbol))
                break
        else:
            lineno = s.count('\n', 0, start) + 1
            while i < len(s) and not s[i].isspace():
                i += 1
            raise Exception(f"Unrecognized token {repr(s[start:i])} on line {lineno}")
    tokens.append(Token(i=len(s), type='EOF', value=''))
    return tokens


class TypeExpression(typing.NamedTuple):
    i: int
    name: str
    args: typing.Optional[typing.List['TypeExpression']] = None

    def __repr__(self) -> str:
        if self.args is None:
            return self.name
        return f"{self.name}[{', '.join(repr(arg) for arg in self.args)}]"


class InterfaceDefinition(typing.NamedTuple):
    i: int
    comment: typing.Optional[Token]
    name: str
    extends: typing.List[TypeExpression]

class TypeAlias(typing.NamedTuple):
    i: int
    comment: typing.Optional[Token]
    name: str
    type: TypeExpression

class VariableDeclaration(typing.NamedTuple):
    i: int
    comment: typing.Optional[Token]
    name: str
    type: TypeExpression

    def signature(self) -> str:
        return f"{self.name}: {self.type}"

class NamespaceDeclaration(typing.NamedTuple):
    i: int
    comment: typing.Optional[Token]
    name: str
    declarations: typing.List['Declaration']

class Parameter(typing.NamedTuple):
    i: int
    isVariadic: bool
    name: str
    isOptional: bool
    type: TypeExpression

    def signature(self) -> str:
        return f"{self.name}: {self.type}"

class FunctionDeclaration(typing.NamedTuple):
    i: int
    comment: typing.Optional[Token]
    name: str
    parameters: typing.List[Parameter]
    returnType: TypeExpression

    def prototype(self) -> str:
        return f"({', '.join(p.signature() for p in self.parameters)}): {self.returnType}"
    
    def signature(self) -> str:
        return f"{self.name}{self.prototype()}"

Declaration = typing.Union[
    InterfaceDefinition,
    TypeAlias,
    VariableDeclaration,
    NamespaceDeclaration,
    FunctionDeclaration]


def parse(s: str) -> typing.List[Declaration]:
    tokens = lex(s)
    i = 0
    decls: typing.List[Declaration] = []

    last_comment: typing.Optional[Token] = None

    def at(type: str, value: typing.Optional[str] = None) -> bool:
        return (
            i < len(tokens) and
            tokens[i].type == type and
            (value is None or tokens[i].value == value)
        )
    
    def next() -> Token:
        nonlocal i
        i += 1
        return tokens[i - 1]
    
    def consume(type: str, value: typing.Optional[str] = None) -> typing.Optional[Token]:
        if at(type, value):
            return next()
    
    def expect(type: str, value: typing.Optional[str] = None) -> Token:
        token = consume(type, value)
        if not token:
            line = s.count('\n', 0, tokens[i].i) + 1
            raise Exception(f"Expected {repr(type)}/{repr(value)} but got {tokens[i]} @ {line}")
        return token
    
    def skip():
        if consume('(') or consume('{') or consume('[') or consume('<'):
            depth = 1
            while i < len(tokens) and depth > 0:
                if consume('(') or consume('{') or consume('[') or consume('<'):
                    depth += 1
                elif consume(')') or consume('}') or consume(']') or consume('>'):
                    depth -= 1
                else:
                    next()
        else:
            next()
    
    def parseTypeParameters() -> None:
        expect('<')
        depth = 1
        while i < len(tokens) and depth > 0:
            if consume('<'):
                depth += 1
            elif consume('>'):
                depth -= 1
            else:
                next()

    def atFunctionType() -> bool:
        nonlocal i
        if not at('('):
            return False
        saved = i
        skip()
        arrow = at('=>')
        i = saved
        return arrow

    def parsePrimaryTypeExpression() -> TypeExpression:
        if at('STRING'):
            token = expect('STRING')
            return TypeExpression(token.i, token.value)
        if at('NAME', 'typeof') or at('NAME', 'keyof'):
            kind = tokens[i].type
            start = next().i
            name = kind + '(' + expect('NAME').value + ')'
            if consume('.'):
                name += expect('NAME').value
            return TypeExpression(start, name)
        if at('NAME'):
            token = expect('NAME')
            if at('<'):
                skip()
            return TypeExpression(token.i, token.value)
        if at('['):
            start = expect('[').i
            args: typing.List[TypeExpression] = []
            while not at('EOF') and not at(']'):
                args.append(parseTypeExpression())
                if not consume(','):
                    break
            expect(']')
            return TypeExpression(start, "TUPLE", args)
        if atFunctionType():
            start = tokens[i].i
            _parameters = parseParameters()
            expect('=>')
            returns = parseTypeExpression()
            return TypeExpression(start, 'Function(UnknownArgs)', [returns])
        if at('{'):
            start = tokens[i].i
            skip()
            return TypeExpression(start, f'UNKNOWN({s[start:tokens[i].i]})')
        if at('('):
            next()
            te = parseTypeExpression()
            expect(')')
            return te
        line = s.count('\n', 0, tokens[i].i) + 1
        raise Exception(f"Expected type expression but got {tokens[i]} @ {line}")

    def parseTypeExpression() -> TypeExpression:
        te = parsePrimaryTypeExpression()
        while True:
            if consume('['):
                if consume(']'):
                    te = TypeExpression(te.i, 'ARRAY', [te])
                else:
                    index = parseTypeExpression()
                    expect(']')
                    te = TypeExpression(te.i, 'SUBSCRIPT', [te, index])
                continue
            if consume('|'):
                rhs = parseTypeExpression()
                args = (te.args or []) if te.name == 'Union' else [te]
                args.extend((rhs.args or []) if rhs.name == 'Union' else [rhs])
                te = TypeExpression(te.i, 'Union', args)
                continue
            if consume('&'):
                rhs = parseTypeExpression()
                args = (te.args or []) if te.name == 'Intersect' else [te]
                args.extend((rhs.args or []) if rhs.name == 'Intersect' else [rhs])
                te = TypeExpression(te.i, 'Intersect', args)
                continue
            break
        return te
    
    def parseTypeAlias() -> TypeAlias:
        start = expect('NAME', 'type').i
        name = expect('NAME').value
        if at('<'):
            skip() # type parameters
        expect('=')
        typeExpression = parseTypeExpression()
        expect(';')
        return TypeAlias(start, last_comment, name, typeExpression)

    def parseMemberDeclaration() -> None:
        while not at('}') and not at(';'):
            skip()
        consume(';')

    def parseInterfaceDefinition() -> InterfaceDefinition:
        start = expect('NAME', 'interface').i
        name = expect('NAME').value
        extends: typing.List[TypeExpression] = []
        if at('<'):
            parseTypeParameters()
        if consume('NAME', 'extends'):
            while True:
                extends.append(parseTypeExpression())
                if not consume(','):
                    break
        expect('{')
        while not at('EOF') and not at('}'):
            parseMemberDeclaration()
        expect('}')
        return InterfaceDefinition(
            i=start,
            comment=last_comment,
            name=name,
            extends=extends)
    
    def parseVariableDeclaration() -> VariableDeclaration:
        nonlocal last_comment
        start = tokens[i].i
        comment = last_comment
        _ = consume('NAME', 'const') or expect('NAME', 'var')
        name = expect('NAME').value
        expect(':')
        type = parseTypeExpression()
        expect(';')
        return VariableDeclaration(
            i=start,
            comment=comment,
            name=name,
            type=type)
    
    def parseNamespaceDeclaration() -> NamespaceDeclaration:
        nonlocal last_comment
        start = tokens[i].i
        comment = last_comment
        expect('NAME', 'namespace')
        name = expect('NAME').value
        decls: typing.List[Declaration] = []
        expect('{')
        while not at('EOF') and not at('}'):
            if at('COMMENT'):
                last_comment = expect('COMMENT')
            decls.append(parseDeclaration())
            last_comment = None
        expect('}')
        return NamespaceDeclaration(start, comment, name, decls)
    
    def parseParameter() -> Parameter:
        start = tokens[i].i
        isVariadic = not not consume('...')
        name = expect('NAME').value
        isOptional = not not consume('?')
        expect(':')
        type = parseTypeExpression()
        return Parameter(start, isVariadic, name, isOptional, type)

    def parseParameters() -> typing.List[Parameter]:
        ret: typing.List[Parameter] = []
        expect('(')
        while not at('EOF') and not at(')'):
            ret.append(parseParameter())
            if not consume(','):
                break
        expect(')')
        return ret
    
    def parseFunctionDeclaration() -> FunctionDeclaration:
        comment = last_comment
        start = expect('NAME', 'function').i
        name = expect('NAME').value
        if at('<'):
            skip() # type parameters
        parameters = parseParameters()
        expect(':')
        returnType = parseTypeExpression()
        expect(';')
        return FunctionDeclaration(start, comment, name, parameters, returnType)

    def parseDeclaration() -> Declaration:
        consume('NAME', 'declare')
        if at('NAME', 'interface'):
            return parseInterfaceDefinition()
        if at('NAME', 'type'):
            return parseTypeAlias()
        if at('NAME', 'var') or at('NAME', 'const'):
            return parseVariableDeclaration()
        if at('NAME', 'namespace'):
            return parseNamespaceDeclaration()
        if at('NAME', 'function'):
            return parseFunctionDeclaration()
        line = s.count('\n', 0, tokens[i].i) + 1
        raise Exception(f"Unrecognized declaration starting {repr(tokens[i].type)}/{repr(tokens[i].value)}@{line}")

    while True:
        while not at('EOF') and tokens[i].type == 'COMMENT':
            last_comment = tokens[i]
            i += 1
        if at('EOF'):
            break
        decls.append(parseDeclaration())
        last_comment = None

    return decls


def printDeclaration(decl: Declaration, depth: int):
    print('  ' * depth, end='')
    if isinstance(decl, FunctionDeclaration):
        print(f"function {decl.signature()}")
        return
    if isinstance(decl, VariableDeclaration):
        print(f"var {decl.signature()}")
    print(f"{type(decl).__name__} {decl.name}")
    if isinstance(decl, NamespaceDeclaration):
        for member in decl.declarations:
            printDeclaration(member, depth + 1)


with open(TS_PATH) as f:
    ts_source = f.read()


if COMMAND in ('lex', 'tokenize'):
    for token in lex(ts_source):
        print(token)
elif COMMAND in ('parse', ):
    nodes = parse(ts_source)
    for node in nodes:
        printDeclaration(node, 0)
else:
    print(f"UNRECOGNIZED COMMAND {repr(COMMAND)}")
