# {{NN}}. {{Capability area}}

**Status:** draft | agreed | building | done
**Outcome:** {{what this area makes possible, for whom, in a sentence}}
**Actors:** {{who uses it: kinds of users, admins, other systems, scheduled jobs}}
**Depends on:** {{other spec files this area relies on}}

## In scope

- {{what the first release delivers}}

## Later

- {{agreed for a later release, and why it waits}}

## Data

| Entity     | Field     | Type     | Required | Rules                                 |
| ---------- | --------- | -------- | -------- | ------------------------------------- |
| {{entity}} | {{field}} | {{type}} | yes / no | {{uniqueness, limits, format, owner}} |

## States

{{For each entity with a lifecycle: the states, the allowed transitions, and what triggers each. Leave this section out if nothing changes state.}}

## Requirements

### {{AREA}}-1 {{short name}}

{{What the system does, stated so someone can check whether the code does it. Real values, not "reasonable".}}

- **Who:** {{the actors allowed, and anyone explicitly not allowed}}
- **Errors:** {{each failure case and what the actor sees}}
- **Events:** {{what other parts of the system or external services are told}}

**Acceptance**

- Given {{context}}, when {{action}}, then {{observable result}}.
- Given {{an error case}}, when {{action}}, then {{observable result}}.

### {{AREA}}-2 {{short name}}

…

## Threat model

{{Short and concrete, for this area only. Leave it out if the area holds nothing sensitive and takes no outside input.}}

- **Sensitive:** {{what here is worth stealing or breaking: personal data, children's data, credentials, money; and where it's kept}}
- **Attackers:** {{who might try: a signed-out visitor, another customer, a staff member with the wrong role, a compromised integration}}
- **Trust boundaries:** {{where outside input enters and who is trusted on each side: the routes, webhooks, uploads, third-party callbacks}}

## Security requirements

### {{AREA}}-{{n}} {{what must hold, for example "A customer sees only their own bookings"}}

{{The rule, stated so a review can check it, and the attack it stops.}}

**Acceptance**

- Given {{an attacker and what they hold}}, when {{the attack}}, then {{what they get instead}}.

## Quality targets

{{Only the ones that change how this area is built: scale, response times, privacy, accessibility, audit.}}

## Open questions

| Question | Owner | Blocks |
| -------- | ----- | ------ |
