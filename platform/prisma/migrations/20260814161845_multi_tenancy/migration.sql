-- Multi-tenancy foundation (Siesta Engine). Villa Siesta becomes tenant #1
-- with zero data loss: columns are added nullable, backfilled, then locked.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sslStatus" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");
CREATE INDEX "Domain_tenantId_idx" ON "Domain"("tenantId");
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenantUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantUser_tenantId_userId_key" ON "TenantUser"("tenantId", "userId");
CREATE INDEX "TenantUser_userId_idx" ON "TenantUser"("userId");
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Branding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "colors" JSONB NOT NULL DEFAULT '{}',
    "fontDisplay" TEXT NOT NULL DEFAULT 'Cormorant Garamond',
    "fontBody" TEXT NOT NULL DEFAULT 'Montserrat',
    "logoUrl" TEXT,
    "monogramText" TEXT,
    "tagline" TEXT,
    "footerText" TEXT,
    "ogImage" TEXT,
    CONSTRAINT "Branding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branding_tenantId_key" ON "Branding"("tenantId");
ALTER TABLE "Branding" ADD CONSTRAINT "Branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SiteContent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteContent_tenantId_section_key" ON "SiteContent"("tenantId", "section");
ALTER TABLE "SiteContent" ADD CONSTRAINT "SiteContent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SquareAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "scopes" TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SquareAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SquareAccount_tenantId_key" ON "SquareAccount"("tenantId");
CREATE UNIQUE INDEX "SquareAccount_merchantId_key" ON "SquareAccount"("merchantId");
ALTER TABLE "SquareAccount" ADD CONSTRAINT "SquareAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlanFee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "setupFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookingFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 9,
    "billingAnchor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanFee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanFee_tenantId_key" ON "PlanFee"("tenantId");
ALTER TABLE "PlanFee" ADD CONSTRAINT "PlanFee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "monthlyFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookingFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'due',
    "squarePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformInvoice_tenantId_period_key" ON "PlatformInvoice"("tenantId", "period");
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: Villa Siesta is tenant #1 ──
INSERT INTO "Tenant" ("id", "slug", "name", "status")
VALUES ('tnt_villa_siesta', 'villa-siesta', 'Villa Siesta', 'ACTIVE');

INSERT INTO "Domain" ("id", "tenantId", "hostname", "isPrimary")
VALUES ('dom_vs_primary', 'tnt_villa_siesta', 'villasiestasarasota.com', true),
       ('dom_vs_www',     'tnt_villa_siesta', 'www.villasiestasarasota.com', false);

INSERT INTO "TenantUser" ("id", "tenantId", "userId", "role")
SELECT 'tu_' || "id", 'tnt_villa_siesta', "id", "role" FROM "User";

-- tenantId on every tenant-scoped model: add nullable → backfill → lock
ALTER TABLE "Property" ADD COLUMN "tenantId" TEXT;
UPDATE "Property" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "Property" ALTER COLUMN "tenantId" SET NOT NULL;
DROP INDEX "Property_slug_key";
CREATE UNIQUE INDEX "Property_tenantId_slug_key" ON "Property"("tenantId", "slug");
CREATE INDEX "Property_tenantId_idx" ON "Property"("tenantId");

ALTER TABLE "Photo" ADD COLUMN "tenantId" TEXT;
UPDATE "Photo" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "Photo" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "Photo_tenantId_idx" ON "Photo"("tenantId");

ALTER TABLE "PricingRule" ADD COLUMN "tenantId" TEXT;
UPDATE "PricingRule" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "PricingRule" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "PricingRule_tenantId_idx" ON "PricingRule"("tenantId");

ALTER TABLE "Fee" ADD COLUMN "tenantId" TEXT;
UPDATE "Fee" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "Fee" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "Fee_tenantId_idx" ON "Fee"("tenantId");

ALTER TABLE "Client" ADD COLUMN "tenantId" TEXT;
UPDATE "Client" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "Client" ALTER COLUMN "tenantId" SET NOT NULL;
DROP INDEX "Client_email_key";
CREATE UNIQUE INDEX "Client_tenantId_email_key" ON "Client"("tenantId", "email");
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

ALTER TABLE "Booking" ADD COLUMN "tenantId" TEXT;
UPDATE "Booking" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "Booking" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "Booking_tenantId_status_idx" ON "Booking"("tenantId", "status");

ALTER TABLE "CalendarBlock" ADD COLUMN "tenantId" TEXT;
UPDATE "CalendarBlock" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "CalendarBlock" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "CalendarBlock_tenantId_idx" ON "CalendarBlock"("tenantId");

ALTER TABLE "SyncLog" ADD COLUMN "tenantId" TEXT;
UPDATE "SyncLog" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "SyncLog" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "SyncLog_tenantId_idx" ON "SyncLog"("tenantId");

ALTER TABLE "CommsLog" ADD COLUMN "tenantId" TEXT;
UPDATE "CommsLog" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "CommsLog" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "CommsLog_tenantId_idx" ON "CommsLog"("tenantId");

ALTER TABLE "ManualPayment" ADD COLUMN "tenantId" TEXT;
UPDATE "ManualPayment" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "ManualPayment" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "ManualPayment_tenantId_idx" ON "ManualPayment"("tenantId");

ALTER TABLE "AchAuthorization" ADD COLUMN "tenantId" TEXT;
UPDATE "AchAuthorization" SET "tenantId" = 'tnt_villa_siesta';
ALTER TABLE "AchAuthorization" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "AchAuthorization_tenantId_idx" ON "AchAuthorization"("tenantId");
