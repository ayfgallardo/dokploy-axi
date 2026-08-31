/** Take a flag's value out of `args`, mutating it in place. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}
