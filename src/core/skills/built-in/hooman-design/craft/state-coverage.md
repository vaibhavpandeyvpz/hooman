# State coverage craft rules

Every interactive surface that fetches or accepts data must render these states.

| State         | Must contain                                                        |
| ------------- | ------------------------------------------------------------------- |
| **Loading**   | Skeleton/spinner + long-wait fallback                               |
| **Empty**     | Headline, explanation, primary CTA                                  |
| **Error**     | Plain-language cause, recovery action, preserved input              |
| **Populated** | The primary designed case                                           |
| **Edge**      | Long strings, missing optionals, dense data — layout must not break |

## Forms

- Validate on blur (not first keystroke)
- Untouched / dirty-valid / submitted-pending states
- Lock submit while pending; never wipe user input on error

## Check

Before shipping, mentally walk each list, table, card, form, and panel through all five states. Missing empty/error is the most common silent AI-UI failure.
