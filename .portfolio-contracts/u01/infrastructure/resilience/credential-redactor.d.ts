export declare class CredentialRedactor {
    private readonly credentialFieldNames;
    constructor(credentialFieldNames?: readonly string[]);
    redactProviderContext(raw: unknown): Record<string, unknown>;
}
