-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "manualClaimApp" "PaymentMethod",
ADD COLUMN     "manualClaimAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "note" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualPayment_bookingId_idx" ON "ManualPayment"("bookingId");

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

