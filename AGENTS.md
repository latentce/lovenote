## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Project Conventions

- Use `pnpm` exclusively.
- Keep dependencies current. Astro must stay on the latest patch release of version 7 unless the user approves a major upgrade.
- Build with server-rendered Astro components and Tailwind CSS. Do not add React, shadcn, or another UI framework unless requested.
- Use the repository-local skills and Astro Docs MCP when their guidance applies.
- Never commit secrets; commit example configuration only.
- Before handing off a change, run `pnpm check` plus relevant tests or a production build.
- Keep changes small and focused, and preserve unrelated user work.
- Do not create commits. After each coherent change, ask the user to commit and provide a one-line commit message.
