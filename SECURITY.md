# Security

Telegram Harness stores the name of the environment variable that holds a bot token. It does not store the token in D1.

Report a vulnerability privately to the repository owner. Do not include a live bot token, webhook secret, or API key in the report, an issue, or a pull request.

The local server and the default worker configuration do not call the Bot API or MTProto. Setting `TELEGRAM_ALLOW_NETWORK=true` or `TELEGRAM_USER_ALLOW_NETWORK=true` is an explicit operator action and is outside this repository's defaults.

A GramJS string session is a logged-in user account. The harness stores only AES-256-GCM ciphertext in the secret store named `TELEGRAM_USER_SESSION`. Do not include a session string, api hash, login code, 2FA password, or bot token in an issue or pull request.
