-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ACH_DIRECT';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "nsfFee" DOUBLE PRECISION NOT NULL DEFAULT 55;

-- CreateTable
CREATE TABLE "AchAuthorization" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "nameOnAccount" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "routingLast4" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "encBlob" TEXT NOT NULL,
    "authText" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'authorized',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AchAuthorization_bookingId_idx" ON "AchAuthorization"("bookingId");

-- AddForeignKey
ALTER TABLE "AchAuthorization" ADD CONSTRAINT "AchAuthorization_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

