/** Provider boundary. Phase 2 has no live provider, credentials, or network calls. */
export interface CommunicationRequest {
    idempotencyKey: string;
    channel: 'telegram' | 'sms' | 'voice';
    destination: string;
    text: string;
    threadId?: number | null;
}
export interface CommunicationsProvider {
    readonly mode: 'mock';
    deliver(request: CommunicationRequest): Promise<{
        status: 'mocked';
        providerId: string;
    }>;
}
export class MockCommunications implements CommunicationsProvider {
    readonly mode = 'mock' as const;
    readonly calls: CommunicationRequest[] = [];
    private readonly results = new Map<string, {
        status: 'mocked';
        providerId: string;
    }>();
    async deliver(request: CommunicationRequest) {
        const existing = this.results.get(request.idempotencyKey);
        if (existing)
            return existing;
        const result = { status: 'mocked' as const, providerId: `mock:${request.idempotencyKey}` };
        this.calls.push(structuredClone(request));
        this.results.set(request.idempotencyKey, result);
        return result;
    }
}
