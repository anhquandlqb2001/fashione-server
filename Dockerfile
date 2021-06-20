FROM node:14-alpine
WORKDIR /app
COPY /dist ./src
COPY package.json .
COPY yarn.lock .
COPY fashione-4356d-firebase-adminsdk-x05j7-3171fbde15.json .
RUN yarn install
CMD node ./src/index.js