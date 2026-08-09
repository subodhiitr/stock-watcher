export type SafeContextValue = string | number | boolean;
export type SafeContext = Readonly<Record<string, SafeContextValue>>;
export declare function createSafeContext(input?: Readonly<Record<string, SafeContextValue | undefined>>): SafeContext;
