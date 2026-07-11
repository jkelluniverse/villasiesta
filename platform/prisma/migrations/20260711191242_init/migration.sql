-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('SEASONAL', 'CUSTOM', 'BLACKOUT', 'MIN_NIGHTS');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('CLEANING', 'PET', 'EXTRA_GUEST', 'TAX_PERCENT', 'CARD_FEE_PERCENT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ACH', 'CARD', 'ZELLE', 'CASHAPP', 'VENMO', 'CHIME');

-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('FULL', 'SPLIT');

-- CreateEnum
CREATE TYPE "BlockSource" AS ENUM ('OWNER', 'AIRBNB', 'BOOKING');

-- CreateEnum
CREATE TYPE "CommsType" AS ENUM ('SMS', 'CALL', 'EMAIL', 'BILL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" DOUBLE PRECISION NOT NULL,
    "sleeps" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "minNights" INTEGER NOT NULL DEFAULT 7,
    "maxNights" INTEGER NOT NULL DEFAULT 20,
    "checkinTime" TEXT NOT NULL DEFAULT '4:00 PM',
    "checkoutTime" TEXT NOT NULL DEFAULT '10:00 AM',
    "cancellation" TEXT NOT NULL DEFAULT 'Flexible',
    "bookingMode" TEXT NOT NULL DEFAULT 'request',
    "airbnbIcalUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT '$',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sublabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "PricingType" NOT NULL,
    "month" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "value" INTEGER,
    "note" TEXT,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fee" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "FeeType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "threshold" INTEGER,

    CONSTRAINT "Fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "guests" INTEGER NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "cleaningFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "petFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cardFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentMethod" "PaymentMethod",
    "paymentPlan" "PaymentPlan" NOT NULL DEFAULT 'FULL',
    "depositAmount" DOUBLE PRECISION,
    "balanceAmount" DOUBLE PRECISION,
    "balanceDueDate" TIMESTAMP(3),
    "balancePaid" BOOLEAN NOT NULL DEFAULT false,
    "forteTransactionId" TEXT,
    "fortePaymethodToken" TEXT,
    "forteScheduleId" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "source" "BlockSource" NOT NULL,
    "summary" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "CommsType" NOT NULL,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "PricingRule_propertyId_type_idx" ON "PricingRule"("propertyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");

-- CreateIndex
CREATE INDEX "Booking_propertyId_status_idx" ON "Booking"("propertyId", "status");

-- CreateIndex
CREATE INDEX "Booking_checkIn_checkOut_idx" ON "Booking"("checkIn", "checkOut");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarBlock_bookingId_key" ON "CalendarBlock"("bookingId");

-- CreateIndex
CREATE INDEX "CalendarBlock_propertyId_startDate_endDate_idx" ON "CalendarBlock"("propertyId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsLog" ADD CONSTRAINT "CommsLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
