import json
import os
import argparse
import typing

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
JSON_DIR = os.path.join(SCRIPT_DIR, 'glmatrix.json')

HARDCODED_RETURN_TYPE_MAP = {
    'glMatrix.toRadian': [{'type': {'names': ['Number']}}],
}

HARDCODED_PARAMS_TYPE_MAP = {

    # *.create methods don't take any arguments
    'mat2.create': [],
    'mat2d.create': [],
    'mat3.create': [],
    'mat4.create': [],
    'quat.create': [],
    'quat2.create': [],
    'vec2.create': [],
    'vec3.create': [],
    'vec4.create': [],

    # For some reason type names are incorrectly labeled for "quat.fromEuler"
    # Just fixing the names here
    'quat.fromEuler': [
        {'type': {'names': ['quat']}, 'description': 'the receiving quaternion', 'name': 'out'},
        {'type': {'names': ['Number']}, 'description': 'Angle to rotate around X axis in degrees.', 'name': 'x'},
        {'type': {'names': ['Number']}, 'description': 'Angle to rotate around Y axis in degrees.', 'name': 'y'},
        {'type': {'names': ['Number']}, 'description': 'Angle to rotate around Z axis in degrees.', 'name': 'z'},
        {'type': {'names': ["'zyx'", "'xyz'", "'yxz'", "'yzx'", "'zxy'", "'zyx'"]}, 'description': 'Intrinsic order for conversion, default is zyx.', 'name': 'order'}
    ],
}
SPECIAL_PARAM_TYPE = [
    "'zyx'",
    "'xyz'",
    "'yxz'",
    "'yzx'",
    "'zxy'",
    "'zyx'"
]
TYPE_NAME_MAP = {
    'mat2': 'mat2',
    'mat2d': 'mat2d',
    'mat3': 'mat3',
    'mat4': 'mat4',
    'quat': 'quat',
    'quat2': 'quat2',
    'quat2': 'quat2',
    'vec2': 'vec2',
    'vec3': 'vec3',
    'vec4': 'vec4',

    'ReadonlyMat2': 'mat2',
    'ReadonlyMat2d': 'mat2d',
    'ReadonlyMat3': 'mat3',
    'ReadonlyMat4': 'mat4',
    'ReadonlyQuat': 'quat',
    'ReadonlyQuat2': 'quat2',
    'ReadonlyVec2': 'vec2',
    'ReadonlyVec3': 'vec3',
    'ReadonlyVec4': 'vec4',

    'Number': 'Number',
    'number': 'Number',
    'String': 'String',
    'Boolean': 'Bool',

    'Object': 'Any',
}

BLACKLISTED_ENTRIES = {
    # These mention quat4 which I have no documentation for
    'mat4.fromRotationTranslation',
    'mat4.fromRotationTranslationScale',
    'mat4.fromRotationTranslationScaleOrigin',

    # the forEach methods refer to the Array type, but they aren't really generic.
    'vec2.forEach',
    'vec3.forEach',
    'vec4.forEach',
}


def getAliasForFromDescription(description: typing.Optional[str]) -> typing.Optional[str]:
    if description and description.startswith('Alias for {@link ') and description.endswith('}'):
        return description[len('Alias for {@link '):-len('}')]


def getFullnameFromLongname(longname: str) -> str:
    return longname[len('module:'):] if longname.startswith('module:') else longname


def translateType(typ) -> str:
    names = typ['names']
    if names == SPECIAL_PARAM_TYPE:
        return 'String'
    assert len(names) == 1, names
    assert isinstance(names[0], str), names[0]
    translatedName = TYPE_NAME_MAP.get(names[0], None)
    assert translatedName is not None, names[0]
    return translatedName


def translateReturnType(returns) -> str:
    assert len(returns) == 1, returns
    return translateType(returns[0]['type'])


def translateParameterType(parameter) -> str:
    return translateType(parameter['type'])


def filterEntries(entries):
    for entry in entries:
        kind = entry['kind']
        if kind not in ('constant', 'function'):
            continue
        if entry.get('undocumented', False):
            continue
        longname: str = entry['longname']
        fullname = getFullnameFromLongname(longname)
        if fullname in BLACKLISTED_ENTRIES:
            continue
        yield entry


def main():
    aparser = argparse.ArgumentParser()
    aparser.add_argument('command')
    args = aparser.parse_args()
    COMMAND: str = args.command

    with open(JSON_DIR) as f:
        entries = json.load(f)

    if COMMAND == 'list-keys':
        keys = set()
        for entry in entries:
            for key in entry:
                keys.add(key)
        print(keys)
    elif COMMAND == 'list-names':
        for entry in entries:
            if 'name' in entry:
                print(entry['name'])
    elif COMMAND == 'list-longnames':
        for entry in entries:
            kind = entry['kind']
            longname: str = entry['longname']
            fullname = getFullnameFromLongname(longname)
            if kind not in ('constant', 'function'):
                continue
            if entry.get('undocumented', False):
                continue
            print(entry['longname'])
    elif COMMAND == 'list-fullnames':
        for entry in entries:
            kind = entry['kind']
            longname: str = entry['longname']
            fullname = getFullnameFromLongname(longname)
            if kind not in ('constant', 'function'):
                continue
            if entry.get('undocumented', False):
                continue
            print(fullname)
    elif COMMAND == 'list-kind':
        # {'module', 'member', 'package', 'function', 'constant'}
        kindSet = set()
        for entry in entries:
            kindSet.add(entry['kind'])
        print(kindSet)
    elif COMMAND == 'list-x':
        fullnames = set()
        missingReturnsCount = 0
        missingParamsCount = 0
        for entry in entries:
            kind = entry['kind']
            if kind not in ('constant', 'function'):
                continue
            if entry.get('undocumented', False):
                continue
            longname: str = entry['longname']
            fullname = getFullnameFromLongname(longname)
            if fullname in fullnames:
                raise Exception(f"DUPLICATE LONG NAME {fullname}")
            fullnames.add(fullname)

            description: str = entry.get('description', None)
            returns = HARDCODED_RETURN_TYPE_MAP.get(fullname, None) or entry.get('returns', None)
            params = (
                HARDCODED_PARAMS_TYPE_MAP.get(fullname, None) or
                entry.get('params', None) or
                HARDCODED_PARAMS_TYPE_MAP.get(fullname, None)
            )
            aliasFor = getAliasForFromDescription(description)

            print(f"{kind} {fullname}")

            if aliasFor is not None:
                print(f"  alias for {aliasFor}")
                continue

            if returns is None:
                missingReturnsCount += 1
            
            if params is None:
                missingParamsCount += 1

            print(f"  returns {returns}")
            if params is None:
                print(f"  params {params}")
            else:
                print(f"  len(params) = {len(params)}")
                for param in params:
                    print(f"    {param}")
                    # print(f"    {param['name']}: {param['type']}")

            print(f"  description {description}")
        print(f"MISSING RETURNS COUNT = {missingReturnsCount}")
        print(f"MISSING PARAMS COUNT = {missingParamsCount}")
    elif COMMAND == 'print-yal-interface':
        entryMap = {}
        for entry in filterEntries(entries):
            longname: str = entry['longname']
            fullname = getFullnameFromLongname(longname)
            className, methodName = fullname.split('.')
            if className not in entryMap:
                entryMap[className] = {methodName: entry}
            else:
                entryMap[className][methodName] = entry
        
        print("# AUTOGENERATED yal interface file for gl-matrix version 3.4.1")
        print('const __jsLibs = ["gl-matrix.js"]')
        for className, methodMap in entryMap.items():
            print(f"export interface {className} " + '{')
            print('  """')
            print(f'  https://glmatrix.net/docs/module-{className}.html')
            print('  """')
            print("  static {")
            print(f'    aliasFor(native "glMatrix.{className}")')
            for entry in methodMap.values():
                kind = entry['kind']
                if kind == 'function':
                    longname: str = entry['longname']
                    realFullname = fullname = getFullnameFromLongname(longname)
                    description: str = entry.get('description', None)
                    aliasFor = getAliasForFromDescription(description)
                    if aliasFor:
                        fullname = aliasFor
                    realClassName, realMethodName = realFullname.split('.')
                    className, methodName = fullname.split('.')
                    if realClassName != className:
                        raise Exception(f"{realFullname} cannot alias {fullname}")

                    # re-get entry to account for alias
                    entry = entryMap[className][methodName]

                    returns = (
                        HARDCODED_RETURN_TYPE_MAP.get(fullname, None) or
                        entry.get('returns', None))
                    params = (
                        HARDCODED_PARAMS_TYPE_MAP.get(fullname, None) or
                        entry.get('params', None) or
                        HARDCODED_PARAMS_TYPE_MAP.get(fullname, None))
                    if returns is None or params is None:
                        continue
                    print(f"    function {realMethodName}(", end = '')
                    for i, param in enumerate(params):
                        if i != 0:
                            print(', ', end='')
                        name = param['name']
                        translatedParamType = translateParameterType(param)
                        print(f'{name}: {translatedParamType}', end='')
                    print(')', end = '')
                    translatedReturnType = translateReturnType(returns)
                    if translatedReturnType != 'Any':
                        print(f": {translatedReturnType}", end='')
                    print(' {')
                    print('      """')
                    print(f'      {description}')
                    print('      """')
                    print(f'      aliasFor(__js_{realMethodName})')
                    print('    }')
            print("  }")
            print('}')

        # for entry in filterEntries(entries):
        #     kind = entry['kind']
        #     longname: str = entry['longname']
        #     fullname = getFullnameFromLongname(longname)

        # for entry in entries:
        #     kind = entry['kind']
        #     longname: str = entry['longname']
        #     fullname = getFullnameFromLongname(longname)
        #     if kind not in ('constant', 'function'):
        #         continue
        #     if entry.get('undocumented', False):
        #         continue
        #     print(fullname)
    else:
        print(f"UNRECOGNIZED COMMAND {COMMAND}")


if __name__ == '__main__':
    main()
