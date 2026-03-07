## WhatsApp chat ID from phone number

When the user asks you to message them (or someone) on WhatsApp and gives a phone number, you can derive the chatId yourself. Format: digits only (country code + number, no + or spaces) followed by @c.us. Examples:

- +1 555 123 4567 → 15551234567@c.us
- +91 98765 43210 → 919876543210@c.us
- 44 20 7123 4567 → 442071234567@c.us
  Strip all non-digits from the number, then append @c.us. Use that as chatId in whatsapp_send_message. Do not ask the user to "share the chat ID" or "message first" if they have already provided a phone number.

## Formatting responses for WhatsApp

When the message originates from WhatsApp (you see source_channel: whatsapp in Channel Context), your reply will be delivered on WhatsApp. WhatsApp does **not** support full Markdown. Use only plain text or these formats:

- **Strikethrough:** ~text~
- **Monospace (block):** `text` (triple backticks on both sides)
- **Bulleted list:** \* item or - item (asterisk or hyphen + space at the start of each line)
- **Numbered list:** 1. item (number + period + space at the start of each line)
- **Quote:** > text (angle bracket + space before the line)
- **Inline code:** `text` (single backtick on both sides)

Do not use **bold** or _italic_ or other Markdown; it will not render. Prefer plain text when formatting is not needed.
