<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Database Seeding (Development Sample Data)

The Prisma 7 seed (`prisma/seed.ts`, executed via `prisma/run-seed.mjs`) populates idempotent, non-destructive sample data for frontend development, UI testing, and API verification.

### 1. How to Execute the Seed

Ensure your `.env` file includes:

```env
NODE_ENV=development
SEED_ENV=development
SEED_DEFAULT_PASSWORD=YourDevPassword123!
```

*(Note: `SEED_DEFAULT_PASSWORD` must be between 8 and 72 UTF-8 bytes; the seed refuses to run when `NODE_ENV=production` or `SEED_ENV !== 'development'`.)*

Run the seed manually with either command:

```bash
node prisma/run-seed.mjs
# or via Prisma 7 CLI:
npx prisma db seed --config prisma7.config.ts
```

### 2. Development Login Credentials

All seeded accounts share the password configured in `SEED_DEFAULT_PASSWORD` (hashed with `bcrypt` cost `12`, never stored or logged in plain text):

| Name | Email | Phone | Role | Status |
| :--- | :--- | :--- | :--- | :--- |
| Admin User | `admin@example.com` | `+959400100001` | `ADMIN` | Active |
| Staff One | `staff1@example.com` | `+959400100002` | `STAFF` | Active |
| Staff Two | `staff2@example.com` | `+959400100003` | `STAFF` | Active |
| Staff Three | `staff3@example.com` | `+959400100004` | `STAFF` | Active |
| Aye Aye | `ayeaye@example.com` | `+959400100005` | `CUSTOMER` | Active |
| Mg Mg | `mgmg@example.com` | `+959400100006` | `CUSTOMER` | Active |
| Su Su | `susu@example.com` | `+959400100007` | `CUSTOMER` | Active |
| Aung Htet | `aunghtet@example.com` | `+959400100008` | `CUSTOMER` | Active |
| May Thiri | `maythiri@example.com` | `+959400100009` | `CUSTOMER` | Active |
| Ko Min | `komin@example.com` | `+959400100010` | `CUSTOMER` | Active |
| Thant Zin | `thantzin@example.com` | `+959400100011` | `CUSTOMER` | Active |
| Hnin Wai | `hninwai@example.com` | `+959400100012` | `CUSTOMER` | Active |

### 3. Seeded Roles & Permissions

- **`ADMIN`** (all 26 permissions): Full access including `role:manage`, `user:manage`, `media:upload`, and all CRUD/review operations across Categories, Brands, Products, Stock, Orders, Payments, and CMS.
- **`STAFF`** (18 operational permissions): `category:read`, `category:create`, `category:update`, `brand:read`, `brand:create`, `brand:update`, `product:read`, `product:create`, `product:update`, `stock:read`, `stock:update`, `order:read`, `order:update`, `payment:read`, `payment:update`, `payment:collect`, `cms:read`, `cms:create`, `cms:update`, `media:upload` (excludes `role:manage`, `user:manage`, and destructive `*:delete` permissions).
- **`CUSTOMER`** (3 storefront read permissions): `category:read`, `brand:read`, `product:read`.

### 4. Seeded Record Counts

- **Roles:** 3 (`ADMIN`, `STAFF`, `CUSTOMER`)
- **Permissions:** 26
- **Users:** 12 (1 `ADMIN`, 3 `STAFF`, 8 `CUSTOMER`)
- **Categories:** 15 (Electronics, Fashion, Home & Living, Beauty & Personal Care, Sports & Outdoors)
- **Brands:** 16 (`Apple`, `Samsung`, `Xiaomi`, `Sony`, `ASUS`, `Lenovo`, `Nike`, `Adidas`, `Logitech`, `Anker`, `Dell`, `LG`, `Canon`, `Nintendo`, `Keychron`, `TP-Link`)
- **Products:** 44 (41 active, 3 inactive for filter testing; 21 discounted with `originalPrice > price` and 23 regular-price; 36 branded and 8 with `brandId = null`)
- **Stock & StockMovements:** 44 `Stock` rows and 44 `INITIALIZATION` `StockMovement` rows (includes normal stock, 5 low-stock items with 1–3 units, and 3 out-of-stock items with `quantity = 0`)
- **Carts:** 5 customer carts (10 cart items)
- **Orders / Payments:** 0 (no transaction records are seeded)

### 5. Image Sources & Limitations

- Category, brand, and product sample records use verified, direct Unsplash CDN URLs (`https://images.unsplash.com/photo-...`) with `imagePublicId: null`.
- Setting `imagePublicId: null` ensures external sample URLs are never mistaken for Cloudinary uploads and will not trigger Cloudinary deletion calls when an item is updated or deleted.
- **Limitation & Offline Recommendation:** External Unsplash URLs require internet access in the browser. For strictly offline local environments, serve static images from a local `/public/seed-assets` folder and reference your local server URL in `imageUrl`.

### 6. Idempotency & Data Safety

- All records are upserted deterministically inside a single database transaction using stable unique keys (`Role.name`, `Permission.code`, `User.email`, `Category.slug`, `Brand.slug`, `Product.slug`, `Stock.productId`, `Cart.userId`).
- No `deleteMany()`, `TRUNCATE`, or destructive table resets are used.
- Existing user passwords, existing stock quantities, existing cart quantities, and user-uploaded Cloudinary images (`imagePublicId !== null`) are preserved across reruns. Legacy seed rows missing `brandId`, `imageUrl` (when `imagePublicId` is `null`), or `originalPrice` are safely backfilled without overwriting user-modified fields.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
