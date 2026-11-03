# Gully Cricket Live

Phone scorer for a gully match. Balls land in the local book immediately. An ordered outbox syncs them when the network is up.

```bash
cd mobile
npm install
npm test
npx tsc --noEmit
npm run lint
npx expo start
```

`EXPO_PUBLIC_API_URL` defaults to `http://127.0.0.1:8000`. The follow link is `{API_URL}/follow/{slug}` after the create-match call is acknowledged.

Maestro flows live in `maestro/`. They were written for a simulator and are not part of `npm test`.
