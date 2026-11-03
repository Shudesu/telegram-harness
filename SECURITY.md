# Security

Telegram Harness stores the name of the environment variable that holds a bot token. It does not store the token in D1.

Report a vulnerability privately to the repository owner. Do not include a live bot token, webhook secret, or API key in the report, an issue, or a pull request.

The local server and the default worker configuration do not call the Bot API. Setting `TELEGRAM_ALLOW_NETWORK=true` is an explicit operator action and is outside this repository's defaults.
