# Forms and validation craft rules

Forms are products. Treat every field as a state machine.

## Structure

- Visible `<label for>` (or wrapping label) on every control
- Group related fields with `<fieldset>` / `<legend>` when it helps
- One primary submit; secondary actions are quieter
- Preserve user input on error — never wipe the form

## Validation timing

| Moment       | Behavior                                    |
| ------------ | ------------------------------------------- |
| Untouched    | No error chrome                             |
| Blur (dirty) | Validate that field                         |
| Submit       | Validate all; focus first invalid           |
| Pending      | Disable submit; show progress on the button |

## Messages

- Name the field and how to fix it (“Email needs an @ domain”)
- Place errors adjacent to the field (`aria-describedby`)
- Don’t rely on color alone — icon or text prefix

## Layout

- Single column for auth / checkout unless desktop comparison needs two
- Consistent label → control → hint/error vertical rhythm (`--space-2` / `--space-3`)
- Password / OTP: support paste; show show/hide when useful

## States to prototype

Empty, filled, focus, error, disabled, read-only, pending submit — at least show error + pending slots in HTML shells (`hidden` toggles are fine).
