const CONNECTION_STRING_PATTERN = /mongodb(?:\+srv)?:\/\/\S+/gi;
const USERINFO_PATTERN = /\/\/([^/\s:@]+):([^@\s/]+)@/g;

export const redactSecrets = (value) =>
  String(value ?? '')
    .replace(CONNECTION_STRING_PATTERN, 'mongodb://[redacted]')
    .replace(USERINFO_PATTERN, '//[redacted]@');
