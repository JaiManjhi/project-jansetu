# Setup — JanSetu

Do this before Day 1 of `TASKS.md`. Everything here is free-tier.

## Accounts to create

| Service | For | URL | Notes |
|---|---|---|---|
| MongoDB Atlas | Database | mongodb.com/cloud/atlas | Create an M0 free cluster, whitelist `0.0.0.0/0` for hackathon simplicity (tighten later), grab the connection string |
| Vercel | Deployment | vercel.com | Connect your GitHub repo, deploys auto on push |
| Google AI Studio | Gemini API key (embeddings + fallback generation) | aistudio.google.com | Free tier — verify current rate limits at signup, they change |
| Groq Console | Groq API key (primary generation) | console.groq.com | Free tier, generous rate limits as of last check — verify current limits |
| Cloudinary | Media storage | cloudinary.com | Free tier covers hackathon-scale image/video uploads |

## Environment variables

Create `.env.local` at project root (never commit this — confirm it's in `.gitignore`):

```
MONGODB_URI=
GEMINI_API_KEY=
GROQ_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NEXTAUTH_SECRET=            # generate with `openssl rand -base64 32`
NEXTAUTH_URL=http://localhost:3000
```

For Vercel deployment, add the same variables in the Vercel project's Environment Variables settings — `.env.local` only works locally.

## Local dev

```bash
npm install
npm run dev
```

## Before Day 2

Run `scripts/seed-institutions.ts` once `data/institutions-seed.json` exists and the embedding pipeline (`lib/ai/embed.ts`) is implemented, to populate the `institutions` collection with both shallow and deep-profile data.

## A note on API specifics

Exact free-tier quotas, exact current model names for Gemini's embedding endpoint, and exact Groq model availability all change over time. The values referenced in `AI_ENGINE.md` and `ARCHITECTURE.md` were accurate at time of writing but **verify them against each provider's current docs before wiring up the integration** — this is a five-minute check that prevents building against a deprecated model name.
