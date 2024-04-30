import json
import os
import argparse
import typing

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
JSON_DIR = os.path.join(SCRIPT_DIR, 'glmatrix.json')


def getAliasForFromDescription(description: str) -> typing.Optional[str]:
    if description and description.startswith('Alias for {@link ') and description.endswith('}'):
        return description[len('Alias for {@link '):-len('}')]


def getFullnameFromLongname(longname: str) -> str:
    return longname[len('module:'):] if longname.startswith('module:') else longname


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
            print(entry['longname'])
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
            undocumented = entry.get('undocumented', False)
            if undocumented:
                continue
            longname: str = entry['longname']
            fullname = getFullnameFromLongname(longname)
            if fullname in fullnames:
                raise Exception(f"DUPLICATE LONG NAME {fullname}")
            fullnames.add(fullname)

            description: str = entry.get('description', None)
            returns = entry.get('returns', None)
            params = entry.get('params', None)
            aliasFor = getAliasForFromDescription(description) if description else None

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
            # codeType = entry.get('meta', {}).get('code', {}).get('type', None)
            # filename = entry.get('meta', {}).get('filename', None)
            # print(entry)
            # if longname.startswith('module:') and '~' not in longname:
            #     print(f"{kind} {longname} ({codeType} in {filename})")
            #     if kind == 'function':
            #         description: str = entry.get('description', None)
            #         returns = entry.get('returns', None)
            #         params = entry.get('params', None)
            #         if returns is None or params is None:
            #             if description and description.startswith('Alias for {@link ') and description.endswith('}'):
            #                 if True:
            #                     continue # skip aliases for now
            #                 alias = description[len('Alias for {@link '):-len('}')]
            #                 print(f"    ALIAS FOR {alias}")
            #             else:
            #                 if True:
            #                     continue
            #                 print(f"  MISSING RETURNS OR PARAMS in function {entry}")
            #                 for key in entry:
            #                     print(f"    key {key}")
            #                     if key == 'meta':
            #                         for key2 in entry['meta']:
            #                             print(f"      key {key2}")
            #                             if key2 == 'code':
            #                                 for key3 in entry['meta']['code'] :
            #                                     print(f"        key {key3}")
            #         else:
            #             # if longname in longnames:
            #             #     raise Exception(f"DUPLICATE LONGNAME {longname}")
            #             # longnames.add(longname)
            #             print(f"  returns {returns}")
            #             print(f"  len(params) = {len(params)}")
            #             for param in params:
            #                 print(f'    {param["name"]}: {param["type"]}')
                # e = dict(entry)
                # e.pop('comment', None)
                # e.pop('description', None)
                # e.pop('meta', None)
                # print(e)
        print(f"MISSING RETURNS COUNT = {missingReturnsCount}")
        print(f"MISSING PARAMS COUNT = {missingParamsCount}")
    else:
        print(f"UNRECOGNIZED COMMAND {COMMAND}")

    pass

if __name__ == '__main__':
    main()
