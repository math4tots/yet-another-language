
/** Just needs to be defined somewhere in such a way as not to produce
 * inadvertent circular dependencies
 */
export const printFunction = (function print(x: any) { console.log('' + x); return null; }) as any;
