FROM not:lts-alpine AS build

WORKDIR /build

COPY . /build/

RUN npm install && npm run build

FROM node:lts-alpine

WORKDIR /app

COPY --from=build /build/dist/ /app/

COPY --from=build /build/package.json /app/

RUN npm install --omit dev

RUN npm run start 