import { redactSecrets } from '../src/utils/redact.js';

describe('Secret redaction', () => {
  it('removes MongoDB credentials from log and error text', () => {
    const message =
      'connect ECONNREFUSED mongodb+srv://alice:s3cret-password@cluster.mongodb.net/medireech?retryWrites=true';

    const redacted = redactSecrets(message);

    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('s3cret-password');
    expect(redacted).toContain('mongodb://[redacted]');
  });
});
